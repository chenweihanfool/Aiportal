// 入口網「一個框搜全部」（GET /api/search）的純邏輯：參數驗證、切詞、比對、排序級別、snippet、
// 各 kind 把原始資料轉成候選項、stats 計算、30 秒快取。不碰 DB；routes/search.ts 只負責取資料與套 SQL。
// 所有 jsonb／payload 內容都當不可信資料：欄位型別不對就略過那一筆。

/** groups 的固定順序（也是 best 同級時的優先順序）。 */
export const SEARCH_KINDS = [
  "case", "topic", "person", "object", "event", "concept", "method", "source", "idea", "place", "trip", "tool",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** 走 hermes_doc 表（SQL ILIKE）的四個 kind。 */
export const DOC_KINDS = ["event", "concept", "method", "source"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const SEARCH_MAX_Q = 50;
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 20;
export const SNIPPET_CONTEXT = 40;
export const SNIPPET_HEAD = 80;
export const SNIPPET_MAX = 200;
export const CACHE_TTL_MS = 30_000;

export function isSearchKind(v: unknown): v is SearchKind {
  return typeof v === "string" && (SEARCH_KINDS as readonly string[]).includes(v);
}
export function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);
}

// ── 共用小工具（不可信資料的取值）──────────────────────────────────────────
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** 非空字串（去頭尾空白後）才回傳，否則 null。 */
export function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
export function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s) out.push(s);
  }
  return out;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 取 YYYY-MM-DD（容忍 ISO 時間字串，只留日期部分）；不合法回 null。 */
export function dateOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return DATE_RE.test(d) ? d : null;
}

// ── S1 參數驗證 ────────────────────────────────────────────────────────────
export type SearchParams =
  | { ok: true; q: string; terms: string[]; kind: SearchKind | null; limit: number }
  | { ok: false; message: string };

/** 以空白（含全形）切詞，詞轉小寫，去重，最多 5 詞。 */
export function splitTerms(q: string): string[] {
  const out: string[] = [];
  for (const t of q.split(/[\s　]+/)) {
    const w = t.toLowerCase();
    if (w && !out.includes(w)) out.push(w);
    if (out.length >= SEARCH_MAX_TERMS) break;
  }
  return out;
}

/** q：去頭尾空白後 1～50 字；kind：選填且須在 12 種之內；limit：整數 1～20，預設 5。 */
export function validateSearchParams(qRaw: unknown, kindRaw: unknown, limitRaw: unknown): SearchParams {
  if (typeof qRaw !== "string") return { ok: false, message: "q 必填" };
  const q = qRaw.trim();
  if (q.length === 0) return { ok: false, message: "q 不可為空白" };
  if (q.length > SEARCH_MAX_Q) return { ok: false, message: `q 最多 ${SEARCH_MAX_Q} 字` };
  let kind: SearchKind | null = null;
  if (kindRaw !== undefined) {
    if (!isSearchKind(kindRaw)) return { ok: false, message: `kind 必須是 ${SEARCH_KINDS.join("|")} 其中之一` };
    kind = kindRaw;
  }
  let limit = SEARCH_DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw)) return { ok: false, message: "limit 必須是整數" };
    limit = Number(limitRaw);
    if (limit < 1 || limit > SEARCH_MAX_LIMIT) return { ok: false, message: `limit 必須在 1～${SEARCH_MAX_LIMIT} 之間` };
  }
  const terms = splitTerms(q);
  if (terms.length === 0) return { ok: false, message: "q 不可為空白" };
  return { ok: true, q, terms, kind, limit };
}

// ── 候選項、比對、排序 ─────────────────────────────────────────────────────
/** 各 kind 轉出來的統一形狀。text 是搜尋與 snippet 用的內文；snippet 有值時直接當 snippet（case／person／object）。 */
export interface Candidate {
  kind: SearchKind;
  id: string;
  title: string;
  text: string;
  date: string | null;
  snippet?: string;
}

export interface SearchItem {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  date: string | null;
}
export interface SearchGroup {
  kind: SearchKind;
  count: number;
  items: SearchItem[];
}
export interface SearchResult {
  groups: SearchGroup[];
  total: number;
  best: SearchItem | null;
}

/** 每個詞都要命中（標題或內文，不分大小寫的子字串）。 */
export function matchesAll(c: Pick<Candidate, "title" | "text">, terms: string[]): boolean {
  const hay = `${c.title}\n${c.text}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/**
 * 排序級別（小者優先）：0 標題完全相同（與整串查詢，詞以單一空白相接）；1 標題以第一個詞開頭；
 * 2 標題含第一個詞；3 只有內文含。
 */
export function rankOf(title: string, terms: string[]): 0 | 1 | 2 | 3 {
  const t = title.toLowerCase();
  if (t === terms.join(" ")) return 0;
  const first = terms[0] ?? "";
  if (first && t.startsWith(first)) return 1;
  if (first && t.includes(first)) return 2;
  return 3;
}

function cmpCandidates(a: { rank: number; c: Candidate }, b: { rank: number; c: Candidate }): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const da = a.c.date, db = b.c.date;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? 1 : -1; // 新到舊
  }
  if (a.c.title !== b.c.title) return a.c.title < b.c.title ? -1 : 1;
  return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
}

/**
 * snippet：第一個詞在內文第一次命中處前後各 40 字（頭尾被截斷加「…」）；只命中標題時取內文前 80 字；
 * 沒有內文為空字串；最長 200 字。空白一律壓成單一空格。
 */
export function makeSnippet(text: string, firstTerm: string): string {
  const body = text.replace(/\s+/g, " ").trim();
  if (body.length === 0) return "";
  const needle = firstTerm.toLowerCase();
  const idx = needle.length > 0 ? body.toLowerCase().indexOf(needle) : -1;
  let out: string;
  if (idx < 0) {
    out = body.slice(0, SNIPPET_HEAD) + (body.length > SNIPPET_HEAD ? "…" : "");
  } else {
    const start = Math.max(0, idx - SNIPPET_CONTEXT);
    const end = Math.min(body.length, idx + needle.length + SNIPPET_CONTEXT);
    out = (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "");
  }
  return out.length > SNIPPET_MAX ? out.slice(0, SNIPPET_MAX - 1) + "…" : out;
}

function toItem(c: Candidate, terms: string[]): SearchItem {
  const snippet = c.snippet !== undefined ? c.snippet : makeSnippet(c.text, terms[0] ?? "");
  return { kind: c.kind, id: c.id, title: c.title, snippet: snippet.length > SNIPPET_MAX ? snippet.slice(0, SNIPPET_MAX - 1) + "…" : snippet, date: c.date };
}

/**
 * 把各 kind 的候選項濾出命中、排序、截斷，組成 groups／total／best。
 * groups 依 SEARCH_KINDS 固定順序；沒有命中的組不出現；count 是該組命中總數；best 是全部命中中級別最高的一筆（同級依 kind 順序）。
 */
export function runSearch(
  candidates: Partial<Record<SearchKind, Candidate[]>>,
  terms: string[],
  limit: number,
): SearchResult {
  const groups: SearchGroup[] = [];
  let total = 0;
  let best: SearchItem | null = null;
  let bestRank = 99;
  for (const kind of SEARCH_KINDS) {
    const list = candidates[kind];
    if (!list || list.length === 0) continue;
    const hits = list.filter((c) => c.kind === kind && matchesAll(c, terms)).map((c) => ({ c, rank: rankOf(c.title, terms) }));
    if (hits.length === 0) continue;
    hits.sort(cmpCandidates);
    const items = hits.slice(0, limit).map((h) => toItem(h.c, terms));
    groups.push({ kind, count: hits.length, items });
    total += hits.length;
    if (hits[0]!.rank < bestRank) {
      bestRank = hits[0]!.rank;
      best = toItem(hits[0]!.c, terms);
    }
  }
  return { groups, total, best };
}

// ── 各 kind 轉候選項 ───────────────────────────────────────────────────────
export function topicsToCandidates(payload: unknown): Candidate[] {
  if (!isObj(payload) || !Array.isArray(payload["topics"])) return [];
  const out: Candidate[] = [];
  for (const t of payload["topics"] as unknown[]) {
    if (!isObj(t)) continue;
    const id = str(t["id"]);
    const name = str(t["name"]);
    if (!id || !name) continue;
    const why = typeof t["why"] === "string" ? t["why"] : "";
    const body = typeof t["body"] === "string" ? t["body"] : "";
    out.push({ kind: "topic", id, title: name, text: `${why}\n${body}`.trim(), date: dateOf(t["updated"]) });
  }
  return out;
}

export interface GraphEntity {
  kind: "case" | "person" | "object";
  name: string;
  /** 該名稱的事件（已略過壞資料），新→舊。 */
  events: Array<{ id: string; date: string; title: string }>;
}

/** 從圖譜快照的 events／cases 整理出 case／person／object 三種樞紐與其事件，新→舊。 */
export function graphEntities(graph: { events?: unknown; cases?: unknown }): GraphEntity[] {
  const map = new Map<string, GraphEntity>();
  const touch = (kind: GraphEntity["kind"], name: string): GraphEntity => {
    const key = `${kind}\u0000${name}`;
    let e = map.get(key);
    if (!e) { e = { kind, name, events: [] }; map.set(key, e); }
    return e;
  };
  if (Array.isArray(graph.cases)) {
    for (const c of graph.cases as unknown[]) {
      if (!isObj(c)) continue;
      const name = str(c["name"]);
      if (name) touch("case", name);
    }
  }
  if (Array.isArray(graph.events)) {
    for (const ev of graph.events as unknown[]) {
      if (!isObj(ev)) continue;
      const id = str(ev["id"]);
      const date = dateOf(ev["date"]);
      const title = str(ev["title"]);
      if (!id || !date || !title) continue;
      const rec = { id, date, title };
      const seen = new Set<string>();
      const add = (kind: GraphEntity["kind"], name: string | null) => {
        if (!name) return;
        const key = `${kind}\u0000${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        touch(kind, name).events.push(rec);
      };
      add("case", str(ev["case"]));
      if (Array.isArray(ev["participants"])) {
        for (const p of ev["participants"] as unknown[]) if (isObj(p)) add("person", str(p["person"]));
      }
      if (Array.isArray(ev["objects"])) {
        for (const o of ev["objects"] as unknown[]) if (isObj(o)) add("object", str(o["object"]));
      }
    }
  }
  const list = [...map.values()];
  for (const e of list) e.events.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1));
  return list;
}

/** hubNarratives 依 hub 名稱＋kind 分組（略過壞資料）。 */
export function narrativesOf(
  hubNarratives: unknown,
): Map<string, Array<{ date: string; type: string; text: string }>> {
  const map = new Map<string, Array<{ date: string; type: string; text: string }>>();
  if (!Array.isArray(hubNarratives)) return map;
  for (const n of hubNarratives as unknown[]) {
    if (!isObj(n)) continue;
    const hub = str(n["hub"]);
    const kind = n["kind"];
    const text = str(n["text"]);
    const date = dateOf(n["date"]);
    if (!hub || !text || !date || (kind !== "person" && kind !== "case" && kind !== "object")) continue;
    const key = `${kind}\u0000${hub}`;
    const arr = map.get(key) ?? [];
    arr.push({ date, type: typeof n["type"] === "string" ? (n["type"] as string) : "", text });
    map.set(key, arr);
  }
  return map;
}

/** case／person／object：名稱＋樞紐敘事為搜尋文字；snippet 固定為最近一件事件的「日期 標題」；date 為最近事件日期。 */
export function graphToCandidates(graph: { events?: unknown; cases?: unknown; hubNarratives?: unknown }): Candidate[] {
  const narr = narrativesOf(graph.hubNarratives);
  return graphEntities(graph).map((e) => {
    const latest = e.events[0];
    return {
      kind: e.kind,
      id: e.name,
      title: e.name,
      text: (narr.get(`${e.kind}\u0000${e.name}`) ?? []).map((n) => n.text).join("\n"),
      date: latest ? latest.date : null,
      snippet: latest ? `${latest.date} ${latest.title}` : "",
    };
  });
}

/** hermes_doc 的列（event／concept／method／source）。meta 不可信。 */
export function docRowToCandidate(row: { kind: unknown; docKey: unknown; title: unknown; bodyMd: unknown; meta: unknown }): Candidate | null {
  if (!isDocKind(row.kind)) return null;
  const id = str(row.docKey);
  const title = str(row.title);
  if (!id || !title) return null;
  return {
    kind: row.kind, id, title,
    text: typeof row.bodyMd === "string" ? row.bodyMd : "",
    date: isObj(row.meta) ? dateOf(row.meta["date"]) : null,
  };
}

export function ideasToCandidates(ideas: unknown): Candidate[] {
  if (!Array.isArray(ideas)) return [];
  const out: Candidate[] = [];
  for (const i of ideas as unknown[]) {
    if (!isObj(i)) continue;
    const id = str(i["id"]);
    const title = str(i["title"]);
    if (!id || !title) continue;
    const text = [i["why"], i["category"]].filter((x): x is string => typeof x === "string").join("\n");
    out.push({ kind: "idea", id, title, text, date: dateOf(i["lastMentioned"]) });
  }
  return out;
}

export function placesToCandidates(places: unknown): Candidate[] {
  if (!Array.isArray(places)) return [];
  const out: Candidate[] = [];
  for (const p of places as unknown[]) {
    if (!isObj(p)) continue;
    const id = str(p["id"]);
    const name = str(p["name"]);
    if (!id || !name) continue;
    const parts = [p["area"], p["cuisine"], p["why"]].filter((x): x is string => typeof x === "string");
    parts.push(...strList(p["tags"]), ...strList(p["mustTry"]));
    out.push({ kind: "place", id, title: name, text: parts.join("\n"), date: dateOf(p["visitedAt"]) ?? dateOf(p["addedAt"]) });
  }
  return out;
}

export function tripsToCandidates(trips: unknown): Candidate[] {
  if (!Array.isArray(trips)) return [];
  const out: Candidate[] = [];
  for (const t of trips as unknown[]) {
    if (!isObj(t)) continue;
    const id = str(t["id"]);
    const name = str(t["name"]);
    if (!id || !name) continue;
    const parts = [t["area"], t["summary"]].filter((x): x is string => typeof x === "string");
    out.push({ kind: "trip", id, title: name, text: parts.join("\n"), date: dateOf(t["start"]) });
  }
  return out;
}

export function sitesToCandidates(sites: unknown): Candidate[] {
  if (!Array.isArray(sites)) return [];
  const out: Candidate[] = [];
  for (const s of sites as unknown[]) {
    if (!isObj(s)) continue;
    const idRaw = s["id"];
    if (typeof idRaw !== "number" && typeof idRaw !== "string") continue;
    const name = str(s["name"]);
    if (!name) continue;
    out.push({ kind: "tool", id: String(idRaw), title: name, text: typeof s["subtitle"] === "string" ? s["subtitle"] : "", date: null });
  }
  return out;
}

// ── S3 紀錄 body 驗證 ──────────────────────────────────────────────────────
export interface SearchLogInput {
  q: string;
  kind: SearchKind | null;
  total: number;
  clickedKind: SearchKind | null;
  clickedId: string | null;
}
const LOG_KEYS = ["q", "kind", "total", "clickedKind", "clickedId"];
const MAX_ID_CHARS = 200;

/** 合法回物件，不合法回錯誤訊息字串（路由回 400）。 */
export function parseSearchLogBody(body: unknown): SearchLogInput | string {
  if (!isObj(body)) return "body 必須是物件";
  for (const k of Object.keys(body)) if (!LOG_KEYS.includes(k)) return `不認得的欄位：${k}`;
  if (typeof body["q"] !== "string") return "q 必填";
  const q = body["q"].trim();
  if (q.length < 1 || q.length > SEARCH_MAX_Q) return `q 必須是 1～${SEARCH_MAX_Q} 字`;
  const kindRaw = body["kind"] ?? null;
  if (kindRaw !== null && !isSearchKind(kindRaw)) return "kind 不合法";
  const total = body["total"];
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return "total 必須是 0 以上的整數";
  const ck = body["clickedKind"] ?? null;
  if (ck !== null && !isSearchKind(ck)) return "clickedKind 不合法";
  const cid = body["clickedId"] ?? null;
  if (cid !== null && (typeof cid !== "string" || cid.length < 1 || cid.length > MAX_ID_CHARS)) return "clickedId 不合法";
  return { q, kind: kindRaw, total, clickedKind: ck, clickedId: cid };
}

// ── S4 stats ───────────────────────────────────────────────────────────────
export const STATS_DEFAULT_DAYS = 7;
export const STATS_MAX_DAYS = 90;
export const STATS_TOP_ZERO = 10;

/** days：1～90 的整數，未給＝7；不合法回 null（路由回 400）。 */
export function parseStatsDays(raw: unknown): number | null {
  if (raw === undefined) return STATS_DEFAULT_DAYS;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= STATS_MAX_DAYS ? n : null;
}

// ── S5 recent ──────────────────────────────────────────────────────────────
export const RECENT_DEFAULT_LIMIT = 5;
export const RECENT_MAX_LIMIT = 20;

/** limit：1～20 的整數字串，未給＝5；不合法回 null（路由回 400）。 */
export function parseRecentLimit(raw: unknown): number | null {
  if (raw === undefined) return RECENT_DEFAULT_LIMIT;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= RECENT_MAX_LIMIT ? n : null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export interface SearchStats {
  days: number;
  searches: number;
  zero: number;
  zeroRate: number;
  clicked: number;
  clickRate: number;
  topZero: Array<{ q: string; count: number }>;
}

/** 由 SQL 彙總出的次數算成回應；searches 為 0 時 rate 為 0；topZero 依次數多到少（同次數依 q）取 10 筆。 */
export function buildStats(
  days: number,
  searches: number,
  zero: number,
  clicked: number,
  zeroQueries: Array<{ q: string; count: number }>,
): SearchStats {
  const topZero = [...zeroQueries]
    .sort((a, b) => b.count - a.count || (a.q < b.q ? -1 : a.q > b.q ? 1 : 0))
    .slice(0, STATS_TOP_ZERO);
  return {
    days, searches, zero,
    zeroRate: searches > 0 ? round3(zero / searches) : 0,
    clicked,
    clickRate: searches > 0 ? round3(clicked / searches) : 0,
    topZero,
  };
}

// ── B1 30 秒快取 ───────────────────────────────────────────────────────────
export interface TtlCache {
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

/** 依 key 快取載入結果 ttlMs；load 丟錯時不快取、錯誤往外丟。now 可注入給測試。 */
export function createTtlCache(ttlMs: number = CACHE_TTL_MS, now: () => number = Date.now): TtlCache {
  const store = new Map<string, { at: number; value: unknown }>();
  return {
    async get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value as T;
      const value = await load();
      store.set(key, { at: now(), value });
      return value;
    },
    clear() { store.clear(); },
  };
}
