// 範本搜尋的純邏輯：查詢正規化、雙字詞 Dice 相似度、打分、排序。不碰 DB、不碰檔案系統。
// payload（templates feed）一律當不可信資料：欄位型別不對的那筆就略過。

export const TEMPLATE_ID_RE = /^tpl_[0-9a-f]{10}$/;
export const TEMPLATE_MIN_SCORE = 0.3;
export const TEMPLATE_MAX_LIMIT = 20;
export const TEMPLATE_DEFAULT_LIMIT = 5;
export const TEMPLATE_MAX_Q = 50;

const DOC_TYPES = ["函", "簽", "書函", "公告", "便簽", "其他公文", "圖表", "表單", "其他"] as const;
const EXTENSIONS = ["json", "docx", "doc", "odt", "pdf", "xlsx"] as const;

export interface TemplateRecord {
  id: string;
  name: string;
  family: string;
  category: string;
  docType: string;
  subject: string | null;
  version: string | null;
  latest: boolean;
  aliases: string[];
  root: string;
  rel: string;
  ext: string;
  size: number;
  copies: number;
}

export interface TemplateHit {
  id: string;
  name: string;
  family: string;
  category: string;
  docType: string;
  subject: string | null;
  version: string | null;
  score: number;
  olderVersions: number;
}

export interface TemplateSearchResult {
  items: TemplateHit[];
  clearWinner: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROOT_RE = /^[a-z][a-z0-9-]{0,19}$/;

function parseRecord(v: unknown): TemplateRecord | null {
  if (!isObj(v)) return null;
  const id = str(v["id"]);
  const name = str(v["name"]);
  const family = str(v["family"]);
  const category = str(v["category"]);
  const docType = str(v["docType"]);
  const root = str(v["root"]);
  const rel = str(v["rel"]);
  const ext = str(v["ext"]);
  const subjectRaw = v["subject"];
  const versionRaw = v["version"];
  const latest = v["latest"];
  const aliasesRaw = v["aliases"];
  const size = v["size"];
  const copies = v["copies"];
  if (!id || !TEMPLATE_ID_RE.test(id) || !name || !family || !category) return null;
  if (!docType || !(DOC_TYPES as readonly string[]).includes(docType)) return null;
  if (!root || !ROOT_RE.test(root) || !rel || !ext || !(EXTENSIONS as readonly string[]).includes(ext)) return null;
  if (subjectRaw !== null && subjectRaw !== undefined && typeof subjectRaw !== "string") return null;
  if (versionRaw !== null && versionRaw !== undefined && (typeof versionRaw !== "string" || !DATE_RE.test(versionRaw))) return null;
  if (typeof latest !== "boolean") return null;
  if (!Array.isArray(aliasesRaw) || aliasesRaw.some((a) => typeof a !== "string")) return null;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  if (typeof copies !== "number" || !Number.isFinite(copies) || copies < 1) return null;
  return {
    id, name, family, category, docType,
    subject: typeof subjectRaw === "string" ? subjectRaw : null,
    version: typeof versionRaw === "string" ? versionRaw : null,
    latest,
    aliases: aliasesRaw as string[],
    root, rel, ext, size, copies,
  };
}

/** templates feed 的 payload → 合法紀錄（壞資料略過）。payload 不是物件或沒有 templates 陣列回空陣列。 */
export function parseTemplates(payload: unknown): TemplateRecord[] {
  if (!isObj(payload) || !Array.isArray(payload["templates"])) return [];
  const out: TemplateRecord[] = [];
  for (const t of payload["templates"] as unknown[]) {
    const r = parseRecord(t);
    if (r) out.push(r);
  }
  return out;
}

const NOISE = ["給我", "我要", "幫我", "找", "一下", "範本", "樣板", "公文", "檔案", "檔", "json", "JSON", "的"];

/** 去掉空白與口語字樣（給我、範本、公文…）；結果是空字串就回空字串。 */
export function normalizeTemplateQuery(q: string): string {
  let s = q.replace(/[\s　]+/g, "");
  for (const w of NOISE) s = s.split(w).join("");
  return s;
}

/** 字元雙字詞 Dice 係數；任一字串長度 1 時以單字是否相同計。 */
export function bigramDice(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length === 0 || y.length === 0) return 0;
  if (x.length === 1 || y.length === 1) return x === y ? 1 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(x);
  const gb = grams(y);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

const stripExt = (name: string): string => name.replace(/\.[^.]+$/, "");

/** 在 family、name（去副檔名）、aliases、subject、category 中取最高分；包含關係給 1.0，否則取 Dice。 */
export function scoreTemplate(nq: string, t: TemplateRecord): number {
  const q = nq.trim().toLowerCase();
  if (!q) return 0;
  const fields = [t.family, stripExt(t.name), ...t.aliases, t.subject ?? "", t.category];
  let best = 0;
  for (const raw of fields) {
    const f = raw.trim().toLowerCase();
    if (!f) continue;
    const s = f.includes(q) || (f.length >= 2 && q.includes(f)) ? 1 : bigramDice(q, f);
    if (s > best) best = s;
  }
  return best;
}

function cmpVersion(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1; // 新到舊
}

function toHit(t: TemplateRecord, score: number, olderVersions: number): TemplateHit {
  return {
    id: t.id, name: t.name, family: t.family, category: t.category, docType: t.docType,
    subject: t.subject, version: t.version, score, olderVersions,
  };
}

/** 只比 latest=true、分數 ≥0.3 的筆；分數高到低，同分版本新的在前、再依 name。 */
export function searchTemplates(payload: unknown, q: string, limit: number): TemplateSearchResult {
  const nq = normalizeTemplateQuery(q);
  if (!nq) return { items: [], clearWinner: false };
  const all = parseTemplates(payload);
  const olderByFamily = new Map<string, number>();
  for (const t of all) if (!t.latest) olderByFamily.set(t.family, (olderByFamily.get(t.family) ?? 0) + 1);
  const hits: Array<{ t: TemplateRecord; score: number }> = [];
  for (const t of all) {
    if (!t.latest) continue;
    const score = scoreTemplate(nq, t);
    if (score >= TEMPLATE_MIN_SCORE) hits.push({ t, score });
  }
  hits.sort((a, b) => b.score - a.score || cmpVersion(a.t.version, b.t.version) || (a.t.name < b.t.name ? -1 : a.t.name > b.t.name ? 1 : 0));
  const items = hits.slice(0, limit).map(({ t, score }) => toHit(t, score, olderByFamily.get(t.family) ?? 0));
  const clearWinner = hits.length > 0 && (hits.length === 1 || hits[0]!.score >= hits[1]!.score * 1.5);
  return { items, clearWinner };
}

/** 同 family 的所有版本（新到舊）；找不到 id 回 null。 */
export function templateVersions(payload: unknown, id: string): TemplateHit[] | null {
  const all = parseTemplates(payload);
  const target = all.find((t) => t.id === id);
  if (!target) return null;
  const fam = all.filter((t) => t.family === target.family).sort((a, b) => cmpVersion(a.version, b.version));
  const older = fam.filter((t) => !t.latest).length;
  return fam.map((t) => toHit(t, 1, older));
}

/** 依 id 找紀錄；找不到回 null。 */
export function findTemplate(payload: unknown, id: string): TemplateRecord | null {
  return parseTemplates(payload).find((t) => t.id === id) ?? null;
}

/** q：去頭尾空白後 1～50 字；limit：整數 1～20，預設 5。不合法回 null。 */
export function parseTemplateSearchParams(qRaw: unknown, limitRaw: unknown): { q: string; limit: number } | null {
  if (typeof qRaw !== "string") return null;
  const q = qRaw.trim();
  if (q.length < 1 || q.length > TEMPLATE_MAX_Q) return null;
  let limit = TEMPLATE_DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw)) return null;
    limit = Number(limitRaw);
    if (limit < 1 || limit > TEMPLATE_MAX_LIMIT) return null;
  }
  return { q, limit };
}
