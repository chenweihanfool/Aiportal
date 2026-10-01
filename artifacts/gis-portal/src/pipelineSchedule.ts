// 知識萃取管線面板的班表文字。班表以 jobs.json 為準（pipeline-status-pusher 讀取後隨狀態上報），
// 前端不再手寫時間——手寫的班表在 L3 改到 00:10、L5 改到 02:00 後就過時了。

/** 節點副標用的短班表：每日班次只留時間（'每日 10:30、16:30' → '10:30 / 16:30'），多個 job 以 ' / ' 串接；過長截斷。 */
export function shortSchedule(schedules: string[] | undefined | null, fallback: string): string {
  if (!schedules || schedules.length === 0) return fallback
  const parts = schedules.map(s => s.replace(/^每日\s*/, '').replace(/、/g, ' / '))
  const text = parts.join(' / ')
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}

/** 詳情卡「排程」一行：優先用上報的真實班表，沒有才用靜態說明。 */
export function scheduleLine(schedules: string[] | undefined | null, fallback: string | undefined): string | null {
  if (schedules && schedules.length > 0) return schedules.join('；')
  return fallback ?? null
}
