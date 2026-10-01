// 內容層（hermes_doc）的純邏輯：輸入驗證、正文摘錄、概念／方法的「出現脈絡」組裝。
// 全部是純函式（不碰 DB／網路），方便單元測試；routes/hermesDoc.ts 只負責撈資料與呼叫這裡。
// 設計：kb-pipeline docs/portal-content-design.md。

export const DOC_KINDS = ["event", "concept", "method"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const MAX_DOCS_PER_POST = 100;
const MAX_BODY_CHARS = 100_000; // pusher 端以 64 KiB 位元組截斷；這裡只是防呆上限
const MAX_META_CHARS = 300_000;
const MAX_CONTEXTS = 200;
const EXCERPT_CHARS = 160;

export function isDocKind(s: unknown): s is DocKind {
  return typeof s === "string" && (DOC_KINDS as readonly string[]).includes(s);
}

export interface DocInput {
  kind: DocKind;
  key: string;
  title: string;
  bodyMd: string;
  truncated: boolean;
  meta: Record<string, unknown>;
  sourcePath: string | null;
  contentHash: string;
}

/** 驗證 POST body；任何一筆不合格整批拒收（pusher 會大聲失敗，不會半套寫入）。 */
export function validateDocs(body: unknown): { ok: true; docs: DocInput[] } | { ok: false; error: string } {
  const raw = (body as { docs?: unknown } | null)?.docs;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "docs 必須是非空陣列" };
  if (raw.length > MAX_DOCS_PER_POST) return { ok: false, error: `單次最多 ${MAX_DOCS_PER_POST} 筆` };
  const out: DocInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i] as Record<string, unknown> | null;
    const fail = (why: string) => ({ ok: false as const, error: `docs[${i}]：${why}` });
    if (!d || typeof d !== "object") return fail("不是物件");
    if (!isDocKind(d.kind)) return fail("kind 不合法");
    if (typeof d.key !== "string" || !d.key || d.key.length > 300) return fail("key 缺漏或過長");
    if (typeof d.title !== "string" || !d.title || d.title.length > 300) return fail("title 缺漏或過長");
    const bodyMd = d.bodyMd ?? "";
    if (typeof bodyMd !== "string" || bodyMd.length > MAX_BODY_CHARS) return fail("bodyMd 不是字串或過長");
    const truncated = d.truncated ?? false;
    if (typeof truncated !== "boolean") return fail("truncated 必須是布林");
    const meta = d.meta ?? {};
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return fail("meta 必須是物件");
    if (JSON.stringify(meta).length > MAX_META_CHARS) return fail("meta 過大");
    const sourcePath = d.sourcePath ?? null;
    if (sourcePath !== null && (typeof sourcePath !== "string" || sourcePath.length > 300)) return fail("sourcePath 不合法");
    if (typeof d.contentHash !== "string" || d.contentHash.length < 8 || d.contentHash.length > 128) return fail("contentHash 不合法");
    const dedupe = `${d.kind}/${d.key}`;
    if (seen.has(dedupe)) return fail(`同一批內重複的文件 ${dedupe}`);
    seen.add(dedupe);
    out.push({
      kind: d.kind, key: d.key, title: d.title, bodyMd, truncated,
      meta: meta as Record<string, unknown>, sourcePath: sourcePath as string | null, contentHash: d.contentHash,
    });
  }
  return { ok: true, docs: out };
}

/** 一行 markdown 轉成純文字（只給摘錄用）：去強調／行內 code／清單符號，wikilink 取顯示名。 */
function plainLine(line: string): string {
  return line
    .replace(/!?\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const [target, alias] = inner.split("|");
      const name = (alias ?? target.split("/").pop() ?? target).replace(/\.md$/i, "");
      return name;
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*>\s?/, "")
    .trim();
}

// 事件正文裡這幾段是導覽／來源清單（人物、物件、相關事件、來源的 wikilink），不是敘述；摘錄時跳過
// （實機事件檔只有這幾種二級標題加上「更新紀錄」「備註」；敘述文字在第一個標題之前與更新紀錄裡）。
const NAV_SECTIONS = new Set(["相關人物", "相關物件", "See Also", "來源"]);

/** 事件正文的摘錄：略過標題行、導覽段落（NAV_SECTIONS）、分隔線、表格分隔列與空行，取前幾句，
 *  超過 EXCERPT_CHARS 加「…」。 */
export function makeExcerpt(body: string, max = EXCERPT_CHARS): string {
  const parts: string[] = [];
  let len = 0;
  let inNav = false;
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    const h = /^#{1,6}\s+(.*?)\s*$/.exec(t);
    if (h) {
      inNav = /^##\s/.test(t) && NAV_SECTIONS.has(h[1]);
      continue;
    }
    if (inNav || !t || /^[-*_]{3,}$/.test(t) || /^\|?[\s:|-]+\|?$/.test(t)) continue;
    const p = plainLine(t);
    if (!p) continue;
    parts.push(p);
    len += p.length + 1;
    if (len > max) break;
  }
  const s = parts.join(" ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface DocContext {
  eventId: string;
  date: string;
  title: string;
  relation: string | null;
  as: string | null;
  evidence: string | null;
  excerpt: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** 概念／方法的出現脈絡：meta.refs 逐筆配上事件標題與正文摘錄，新→舊。容忍髒資料（缺欄位、非陣列）。 */
export function buildContexts(
  refs: unknown,
  eventById: ReadonlyMap<string, { title: string; date: string }>,
  bodyHeadById: ReadonlyMap<string, string>,
): DocContext[] {
  if (!Array.isArray(refs)) return [];
  const out: DocContext[] = [];
  for (const r of refs) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const eventId = str(o["eventId"]);
    if (!eventId) continue;
    const ev = eventById.get(eventId);
    out.push({
      eventId,
      date: str(o["date"]) ?? ev?.date ?? "",
      title: ev?.title ?? eventId,
      relation: str(o["relation"]),
      as: str(o["as"]),
      evidence: str(o["evidence"]),
      excerpt: makeExcerpt(bodyHeadById.get(eventId) ?? ""),
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.eventId.localeCompare(b.eventId));
  return out.slice(0, MAX_CONTEXTS);
}
