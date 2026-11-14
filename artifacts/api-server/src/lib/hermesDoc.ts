// 內容層（hermes_doc）的純邏輯：輸入驗證、正文摘錄、概念／方法的「出現脈絡」組裝。
// 全部是純函式（不碰 DB／網路），方便單元測試；routes/hermesDoc.ts 只負責撈資料與呼叫這裡。
// 設計：kb-pipeline docs/portal-content-design.md。
import { isRealDate } from "./pushFeedback";

// source：主題來源的原文（一個來源一筆）；topic：已發布主題的引文索引（meta.quotes）；
// diary：日記全文（一筆一天，key 是日期）；insight：從日記萃取的心得（key 是 INS-…）。
export const DOC_KINDS = ["event", "concept", "method", "source", "topic", "diary", "insight"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const MAX_DOCS_PER_POST = 100;
const MAX_BODY_CHARS = 100_000; // pusher 端以 64 KiB 位元組截斷；這裡只是防呆上限
const MAX_META_CHARS = 300_000;
const MAX_CONTEXTS = 200;
const EXCERPT_CHARS = 160;

export function isDocKind(s: unknown): s is DocKind {
  return typeof s === "string" && (DOC_KINDS as readonly string[]).includes(s);
}

// insight（心得）的 key／meta 樣式：一則心得屬於一個群（cluster）、一條脈絡（thread），
// relation 說明它對同脈絡較早一則（parent）是新生／印證／修正／推翻。
const INSIGHT_KEY_RE = /^INS-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;
const INSIGHT_CLUSTER_RE = /^K\d{2}$/;
const INSIGHT_THREAD_RE = /^TH-[0-9a-f]{8}$/;
const INSIGHT_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const INSIGHT_PROVENANCES = new Set(["quote", "relay", "tag"]);
const INSIGHT_RELATIONS = new Set(["new", "reinforce", "refine", "overturn"]);

/** insight 的 meta 檢查；合格回 null，不合格回「哪一條」的錯誤訊息。 */
function validateInsightMeta(key: string, meta: Record<string, unknown>): string | null {
  if (!INSIGHT_KEY_RE.test(key)) return "insight 的 key 必須符合 INS-YYYY-MM-DD-xxxxxxxx";
  if (typeof meta["date"] !== "string" || !isRealDate(meta["date"] as string)) return "insight 的 meta.date 必須是 YYYY-MM-DD 日期";
  const time = meta["time"];
  if (time !== undefined && time !== null && (typeof time !== "string" || !INSIGHT_TIME_RE.test(time))) {
    return "insight 的 meta.time 必須是 HH:MM 或 null";
  }
  if (typeof meta["provenance"] !== "string" || !INSIGHT_PROVENANCES.has(meta["provenance"])) {
    return "insight 的 meta.provenance 必須是 quote|relay|tag";
  }
  const cluster = meta["cluster"];
  if (typeof cluster !== "object" || cluster === null || Array.isArray(cluster)) return "insight 的 meta.cluster 必須是物件";
  const c = cluster as Record<string, unknown>;
  if (typeof c["id"] !== "string" || !INSIGHT_CLUSTER_RE.test(c["id"])) return "insight 的 meta.cluster.id 必須符合 KNN";
  const clusterName = c["name"];
  if (typeof clusterName !== "string" || clusterName.length < 1 || clusterName.length > 12) {
    return "insight 的 meta.cluster.name 必須是 1～12 字";
  }
  if (typeof meta["thread"] !== "string" || !INSIGHT_THREAD_RE.test(meta["thread"])) {
    return "insight 的 meta.thread 必須符合 TH-xxxxxxxx";
  }
  const relation = meta["relation"];
  if (typeof relation !== "string" || !INSIGHT_RELATIONS.has(relation)) {
    return "insight 的 meta.relation 必須是 new|reinforce|refine|overturn";
  }
  const parent = meta["parent"];
  if (relation === "new") {
    if (parent !== undefined && parent !== null) return "insight 的 relation 為 new 時 parent 必須為 null";
  } else if (typeof parent !== "string" || !INSIGHT_KEY_RE.test(parent)) {
    return "insight 的 parent 必須是 INS-YYYY-MM-DD-xxxxxxxx 字串";
  }
  return null;
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
    if (d.kind === "diary") {
      if (!isRealDate(d.key)) return fail("diary 的 key 必須是真實日期 YYYY-MM-DD");
      const metaDate = (meta as Record<string, unknown>)["date"];
      if (metaDate !== undefined && metaDate !== d.key) return fail("diary 的 meta.date 必須等於 key");
    }
    if (d.kind === "insight") {
      if (d.title.length > 80) return fail("insight 的 title 最多 80 字");
      const why = validateInsightMeta(d.key, meta as Record<string, unknown>);
      if (why) return fail(why);
    }
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
