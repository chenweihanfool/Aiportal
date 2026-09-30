// 時間軸（日／週／月／季／年摘要）的純邏輯：輸入驗證、缺漏期間占位、游標分頁、下層期間。
// 全部是純函式（不碰 DB／網路），方便單元測試；routes/hermesTimeline.ts 只負責撈資料與呼叫這裡。
// 設計：kb-pipeline docs/timeline-design.md。

export const TIMELINE_LEVELS = ["day", "week", "month", "quarter", "year"] as const;
export type TimelineLevel = (typeof TIMELINE_LEVELS)[number];

export const CHILD_LEVEL: Record<TimelineLevel, TimelineLevel | null> = {
  year: "quarter",
  quarter: "month",
  month: "week",
  week: "day",
  day: null,
};

const PERIOD_KEY_RE: Record<TimelineLevel, RegExp> = {
  day: /^\d{4}-\d{2}-\d{2}$/,
  week: /^\d{4}-第\d{2}週$/,
  month: /^\d{4}-\d{2}$/,
  quarter: /^\d{4}-Q[1-4]$/,
  year: /^\d{4}$/,
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_ENTRIES_PER_POST = 100;
const MAX_BODY_CHARS = 200_000;

export interface TimelineEntryInput {
  level: TimelineLevel;
  periodKey: string;
  startDate: string;
  endDate: string;
  title: string;
  summary: string;
  bodyMd: string;
  generation: number;
  rangeInferred: boolean;
  periodNote: string | null;
  sourcePath: string | null;
  contentHash: string;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isLevel(s: unknown): s is TimelineLevel {
  return typeof s === "string" && (TIMELINE_LEVELS as readonly string[]).includes(s);
}

/** 驗證 POST body；任何一筆不合格整批拒收（pusher 會大聲失敗，不會半套寫入）。 */
export function validateEntries(
  body: unknown,
): { ok: true; entries: TimelineEntryInput[] } | { ok: false; error: string } {
  const raw = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "entries 必須是非空陣列" };
  if (raw.length > MAX_ENTRIES_PER_POST) return { ok: false, error: `單次最多 ${MAX_ENTRIES_PER_POST} 筆` };
  const out: TimelineEntryInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as Record<string, unknown> | null;
    const fail = (why: string) => ({ ok: false as const, error: `entries[${i}]：${why}` });
    if (!e || typeof e !== "object") return fail("不是物件");
    if (!isLevel(e.level)) return fail("level 不合法");
    if (typeof e.periodKey !== "string" || !PERIOD_KEY_RE[e.level].test(e.periodKey)) return fail("periodKey 格式不符");
    if (!isValidDate(e.startDate) || !isValidDate(e.endDate)) return fail("startDate／endDate 不是有效日期");
    if (e.startDate > e.endDate) return fail("startDate 晚於 endDate");
    if (typeof e.title !== "string" || !e.title || e.title.length > 200) return fail("title 缺漏或過長");
    const summary = e.summary ?? "";
    if (typeof summary !== "string" || summary.length > 400) return fail("summary 不是字串或過長");
    if (typeof e.bodyMd !== "string" || e.bodyMd.length > MAX_BODY_CHARS) return fail("bodyMd 缺漏或過長");
    const generation = e.generation ?? 3;
    if (!Number.isInteger(generation) || (generation as number) < 1 || (generation as number) > 3) return fail("generation 必須是 1~3");
    const rangeInferred = e.rangeInferred ?? false;
    if (typeof rangeInferred !== "boolean") return fail("rangeInferred 必須是布林");
    const periodNote = e.periodNote ?? null;
    if (periodNote !== null && (typeof periodNote !== "string" || periodNote.length > 200)) return fail("periodNote 不合法");
    const sourcePath = e.sourcePath ?? null;
    if (sourcePath !== null && (typeof sourcePath !== "string" || sourcePath.length > 200)) return fail("sourcePath 不合法");
    if (typeof e.contentHash !== "string" || e.contentHash.length < 8 || e.contentHash.length > 128) return fail("contentHash 不合法");
    const key = `${e.level}/${e.periodKey}`;
    if (seen.has(key)) return fail(`同一批內重複的期間 ${key}`);
    seen.add(key);
    out.push({
      level: e.level, periodKey: e.periodKey, startDate: e.startDate, endDate: e.endDate,
      title: e.title, summary: summary as string, bodyMd: e.bodyMd, generation: generation as number,
      rangeInferred, periodNote: periodNote as string | null, sourcePath: sourcePath as string | null,
      contentHash: e.contentHash,
    });
  }
  return { ok: true, entries: out };
}

// ── 游標 ──
export function encodeCursor(startDate: string, periodKey: string): string {
  return Buffer.from(`${startDate}\u0000${periodKey}`, "utf-8").toString("base64url");
}
export function decodeCursor(c: unknown): { startDate: string; periodKey: string } | null {
  if (typeof c !== "string" || !c) return null;
  try {
    const [startDate, periodKey] = Buffer.from(c, "base64url").toString("utf-8").split("\u0000");
    return isValidDate(startDate) && periodKey ? { startDate, periodKey } : null;
  } catch {
    return null;
  }
}

// ── 期間占位（缺漏的週／月／季／年） ──
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function isoWeekMonday(year: number, week: number): string {
  // ISO 週：第 1 週含 1/4；週一為週首
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // 週一=0
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dow);
  week1Monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return week1Monday.toISOString().slice(0, 10);
}
function isoWeeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const dow = (dec28.getUTCDay() + 6) % 7;
  const thursday = new Date(dec28);
  thursday.setUTCDate(dec28.getUTCDate() - dow + 3);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.floor((thursday.getTime() - jan1.getTime()) / (7 * 86400000)) + 1;
}
function lastDayOfMonth(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export interface PeriodShell {
  level: TimelineLevel;
  periodKey: string;
  startDate: string;
  endDate: string;
  title: string;
}

/** 由 min~max 已存在的期間鍵，產出中間「應該有卻不存在」的期間（不含已存在者）。day 級不在此合成。 */
export function missingPeriods(level: TimelineLevel, existingKeys: string[]): PeriodShell[] {
  if (existingKeys.length === 0 || level === "day") return [];
  const have = new Set(existingKeys);
  const out: PeriodShell[] = [];
  const parse = (k: string) => {
    if (level === "week") { const m = /^(\d{4})-第(\d{2})週$/.exec(k)!; return [Number(m[1]), Number(m[2])]; }
    if (level === "month") { const m = /^(\d{4})-(\d{2})$/.exec(k)!; return [Number(m[1]), Number(m[2])]; }
    if (level === "quarter") { const m = /^(\d{4})-Q([1-4])$/.exec(k)!; return [Number(m[1]), Number(m[2])]; }
    return [Number(k), 1];
  };
  const sorted = [...existingKeys].sort();
  const [y0, n0] = parse(sorted[0]);
  const [y1, n1] = parse(sorted[sorted.length - 1]);
  const perYear = level === "week" ? (y: number) => isoWeeksInYear(y) : level === "month" ? () => 12 : level === "quarter" ? () => 4 : () => 1;
  let y = y0, n = n0;
  while (y < y1 || (y === y1 && n <= n1)) {
    let key: string; let start: string; let end: string;
    if (level === "week") {
      key = `${y}-第${String(n).padStart(2, "0")}週`; start = isoWeekMonday(y, n); end = addDays(start, 6);
    } else if (level === "month") {
      key = `${y}-${String(n).padStart(2, "0")}`; start = `${y}-${String(n).padStart(2, "0")}-01`; end = lastDayOfMonth(y, n);
    } else if (level === "quarter") {
      key = `${y}-Q${n}`; start = `${y}-${String((n - 1) * 3 + 1).padStart(2, "0")}-01`; end = lastDayOfMonth(y, n * 3);
    } else {
      key = `${y}`; start = `${y}-01-01`; end = `${y}-12-31`;
    }
    if (!have.has(key)) out.push({ level, periodKey: key, startDate: start, endDate: end, title: key });
    n += 1;
    if (n > perYear(y)) { y += 1; n = 1; }
  }
  return out;
}

// ── 列表 ──
export interface ReportRow {
  level: TimelineLevel;
  periodKey: string;
  startDate: string;
  endDate: string;
  title: string;
  summary: string;
  generation: number;
  rangeInferred: boolean;
  periodNote: string | null;
}
export interface EventRef { id: string; date: string; title: string }

export interface TimelineListItem {
  level: TimelineLevel;
  periodKey: string;
  startDate: string;
  endDate: string;
  title: string;
  summary: string;
  hasReport: boolean;
  rangeInferred: boolean;
  periodNote: string | null;
  generation: number | null;
  eventCount: number;
  events: Array<{ id: string; title: string }>; // 僅 day 級，最多 EVENT_CHIP_LIMIT 筆
  mindScore: number | null;                     // 僅 day 級；＝知識庫健康分數（mind_index_history.score，見 docs 說明）
  hhiScore: number | null;                      // 僅 day 級；＝幸福指數當日顯示分數（happiness_index_history.displayed_score）
}
export const EVENT_CHIP_LIMIT = 8;

function eventsWithin(events: EventRef[], start: string, end: string, today: string): EventRef[] {
  return events.filter((e) => e.date >= start && e.date <= end && e.date <= today); // 未來日事件不顯示
}

export interface BuildListArgs {
  level: TimelineLevel;
  rows: ReportRow[];
  events: EventRef[];
  mindScores: Map<string, number | null>;
  hhiScores?: Map<string, number>;              // 省略＝沒有幸福指數資料（舊呼叫端相容）
  today: string;
  limit: number;
  cursor: string | null;
}

export function buildList(a: BuildListArgs): { items: TimelineListItem[]; nextCursor: string | null } {
  const { level, rows, events, mindScores, today } = a;
  const hhiScores = a.hhiScores ?? new Map<string, number>();
  const items: TimelineListItem[] = rows
    .filter((r) => r.startDate <= today)
    .map((r) => ({
      level, periodKey: r.periodKey, startDate: r.startDate, endDate: r.endDate, title: r.title,
      summary: r.summary, hasReport: true, rangeInferred: r.rangeInferred, periodNote: r.periodNote,
      generation: r.generation, eventCount: 0, events: [], mindScore: null, hhiScore: null,
    }));
  const have = new Set(rows.map((r) => r.periodKey));
  if (level === "day") {
    // 沒有日報、但當天有事件或任一分數（知識庫健康／幸福指數）的日子 → 占位列（仍可點開看事件與分數）
    const days = new Set<string>();
    for (const e of events) if (e.date <= today) days.add(e.date);
    for (const d of mindScores.keys()) if (d <= today) days.add(d);
    for (const d of hhiScores.keys()) if (d <= today) days.add(d);
    for (const d of days) {
      if (have.has(d)) continue;
      items.push({
        level, periodKey: d, startDate: d, endDate: d, title: d, summary: "", hasReport: false,
        rangeInferred: false, periodNote: null, generation: null, eventCount: 0, events: [], mindScore: null, hhiScore: null,
      });
    }
  } else {
    // 只以「已開始」的期間當上下界：未來期間的資料不該把中間拉出不存在的占位列
    for (const p of missingPeriods(level, rows.filter((r) => r.startDate <= today).map((r) => r.periodKey))) {
      if (p.startDate > today) continue;
      items.push({
        ...p, summary: "", hasReport: false, rangeInferred: true, periodNote: null, generation: null,
        eventCount: 0, events: [], mindScore: null, hhiScore: null,
      });
    }
  }
  for (const it of items) {
    const evs = eventsWithin(events, it.startDate, it.endDate, today);
    it.eventCount = evs.length;
    if (level === "day") {
      it.events = evs.slice(0, EVENT_CHIP_LIMIT).map((e) => ({ id: e.id, title: e.title }));
      it.mindScore = mindScores.get(it.periodKey) ?? null;
      it.hhiScore = hhiScores.get(it.periodKey) ?? null;
    }
  }
  items.sort((x, y) => (y.startDate.localeCompare(x.startDate)) || y.periodKey.localeCompare(x.periodKey));
  const cur = decodeCursor(a.cursor);
  const after = cur
    ? items.filter((it) => it.startDate < cur.startDate || (it.startDate === cur.startDate && it.periodKey < cur.periodKey))
    : items;
  const page = after.slice(0, a.limit);
  const last = page[page.length - 1];
  const nextCursor = after.length > a.limit && last ? encodeCursor(last.startDate, last.periodKey) : null;
  return { items: page, nextCursor };
}

/** 下層期間（開對話框時的下鑽清單）：只列已存在報表、起日落在該期間內者，舊→新。 */
export function buildChildren(childRows: ReportRow[], start: string, end: string) {
  return childRows
    .filter((r) => r.startDate >= start && r.startDate <= end)
    .sort((x, y) => x.startDate.localeCompare(y.startDate) || x.periodKey.localeCompare(y.periodKey))
    .map((r) => ({ level: r.level, periodKey: r.periodKey, startDate: r.startDate, title: r.title, summary: r.summary }));
}
