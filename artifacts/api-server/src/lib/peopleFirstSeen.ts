// 人物「首次進入 vault」時間（kb-pipeline pusher 以 People/<名>.md 的 git 首次加入時間算出）。
// POST 端只收「人名 → 可解析的時間字串」的純物件；任何不合格的項目整筆丟掉（回傳 null＝這次推送沒帶、保留上一份）。
// 不存會讓前端算錯的值：無法解析的時間、空名字一律不收。
const MAX_ENTRIES = 5000;
const MAX_NAME_LENGTH = 200;

export type PeopleFirstSeen = Record<string, string>;

export function sanitizePeopleFirstSeen(input: unknown): PeopleFirstSeen | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const out: PeopleFirstSeen = {};
  let n = 0;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) continue;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) continue;
    out[name] = value;
    if (++n >= MAX_ENTRIES) break;
  }
  return out;
}

/** 一個人是否算「這週新增」：有首次落地時間就用它（毫秒比較），沒有才退回關聯事件的最早日期（YYYY-MM-DD）。 */
export function isNewPersonSince(
  firstSeenAt: string | null | undefined,
  firstEventDate: string,
  sinceMs: number,
  sinceDate: string,
): boolean {
  if (firstSeenAt) {
    const t = Date.parse(firstSeenAt);
    if (Number.isFinite(t)) return t >= sinceMs;
  }
  return firstEventDate >= sinceDate;
}
