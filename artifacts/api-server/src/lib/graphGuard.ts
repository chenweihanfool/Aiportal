// hermes-graph 的 POST 是「整份覆寫」。若某個寫入端（例如掃描失敗、掃到空資料夾的舊 collect.ps1）送來
// 空的 events，會把整張關係圖洗成 0，直到下一次正確的推送才補回來——使用者看到「人物／事件數量全是 0」。
// 守門：資料庫已有事件、而這次送來 0 筆 → 拒絕覆寫，保留原本的圖，並留下可追查來源的 log。
// 本來就沒有事件（首次、或確實為空）時照常寫入，不阻擋初始化。
export function shouldRejectEmptyGraph(incomingEventCount: number, existingEventCount: number | null | undefined): boolean {
  return incomingEventCount === 0 && (existingEventCount ?? 0) > 0;
}

export interface PostSource { ip: string | null; forwardedFor: string | null; userAgent: string | null }

/** 供 log 追查「是誰推的」：只取識別用欄位，不含憑證。 */
export function describePostSource(headers: Record<string, string | string[] | undefined>, ip: string | undefined): PostSource {
  const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] : v) ?? null;
  const trim = (s: string | null): string | null => (s === null ? null : s.slice(0, 200));
  return { ip: ip ?? null, forwardedFor: trim(one(headers["x-forwarded-for"])), userAgent: trim(one(headers["user-agent"])) };
}
