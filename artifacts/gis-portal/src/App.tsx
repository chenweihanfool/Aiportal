import { useState, useCallback, useEffect } from 'react'
import { COLOR, FONT } from './theme'
import './portal.css'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const UNLOCK_KEY = 'portal_unlocked'

// ─────────────────────────────────────────────
// Version History  (update this before each release)
// ─────────────────────────────────────────────
const VERSION_HISTORY = [
  {
    version: '2.1.0',
    date: '2026-09-03',
    summary: '六維度改用百分位正規化分數：每個維度的「80 分」現在都代表同一件事',
    changes: [
      '六個維度來自四套完全獨立設計的公式，尺度差很大——有些正常使用下很難超過 60-70（例如運動、心智），有些輕鬆就上 90，直接把原始分數加權平均，「80 分」在每個維度代表完全不同的意義，強行加權平均得出的幸福指數其實很難解讀',
      '改成每個維度都拿「今天的原始分數」對照自己過去 90 天同一維度的分數排百分位（少於 10 天歷史時先用原始分數頂著，避免用太少樣本硬算出誤導性的 0 或 100）——現在六個維度的「80 分」統一代表「這是你自己在這個面向相對表現不錯的一天」，不再糾結某個維度的公式本身好不好拉高',
      '六維度指針錶、幸福指數卡片的雷達圖跟權重佔比，全部改讀正規化後的分數；每張卡片的「詳細數據」裡新增一行「原始分數（未正規化）→ 對照近 90 天百分位」，原始的公式輸出還是看得到，只是不再直接進幸福指數的計算',
      '沒有動任何一個子系統自己的公式（運動、社交 5 人封頂等既有公式都維持原樣）——正規化在 Aiportal 這邊統一做，不用動四套分別維護的計分邏輯',
    ],
  },
  {
    version: '2.0.2',
    date: '2026-08-31',
    summary: '六維度指針錶卡片補回點擊連到對應系統，並在卡片上明確標示',
    changes: [
      '人生進度管理系統／健身追蹤／任務追蹤系統／旅遊生活這四張指針錶卡片，v2.0.0 改版時只留了卡片名稱那一行文字可以點擊，點擊區域比舊版整張卡片小很多、也沒有任何視覺提示看得出來可以點——這次改成整張卡片都能點擊，並在卡片下方新增「前往系統 ↗」標示，跟舊版一樣一眼就能看出這是可以連過去的系統',
      '卡片內「詳細數據」展開/收起的點擊區域補上事件阻止冒泡，避免點開詳細數據時被外層卡片的點擊一起觸發、意外跳轉到外部系統',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-08-31',
    summary: '幸福指數卡片改回雷達圖；修正手機上六維度數字被裁掉的排版問題',
    changes: [
      '幸福指數的六維度改回顯示雷達圖（保留下方的權重佔比說明），不是只有 v2.0.0 的每維度分數文字條——原本用來取代雷達圖的做法被使用者否決，雷達圖跟這幾個分數本來就有其存在理由',
      '修正手機窄螢幕上「指針錶＋六維度數字」左右並排的版面沒有響應式收合規則，導致固定寬度的指針錶＋雷達圖擠在同一列，右側內容被推出可視範圍外、完全看不到——原本在設計預覽裡就有這條 CSS 規則，正式重寫成 React 版時漏掉了，補上手機斷點改成上下堆疊',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-08-31',
    summary: '首頁全面改版：玻璃卡片換成儀表板面板——指針錶、蝕刻刻度、電文式狀態板',
    changes: [
      '整個入口網從玻璃卡片＋粒子背景，改成一塊真正的儀表板面板：翰翰仔幸福指數跟六維度都改用指針錶顯示（開頁時指針會從歸零掃到實際數值），HERMES 戰情室改成電文式狀態讀數板，工具連結改成控制面板開關格＋頻率調諧式搜尋框',
      '拿掉切換用的 3D 小城鎮模式——兩套完全不同的視覺語言同時存在，會削弱新設計「一套儀器語言貫到底」的方向；連帶移除 @react-three/fiber／@react-three/drei／three 這三個只給 3D 模式用的相依套件',
      '幸福指數卡片拿掉跟六維度重複的雷達圖（下面本來就有六個指針錶各自顯示分數，雷達圖只是同一份資料的另一種畫法，不需要兩份），改成每個維度的權重佔比長條',
      '字體換成 Noto Sans TC（中文本文）＋ IBM Plex Mono（所有數字，等寬對齊）＋ Big Shoulders Display（純英文小標籤），配色換成暖灰儀表板金屬感的石墨／琥珀，不再是青紫霓虹玻璃殼',
    ],
  },
  {
    version: '1.36.0',
    date: '2026-08-31',
    summary: '社交指標計分對象改顯示中文名字，不再是英文 person_id',
    changes: [
      '上一版只把 person_id（例如 wife、brother_in_law_elder）原樣列出來，是英文代稱不是中文名字——這次改成 collect.ps1 直接唯讀查 HERMES 的 people.yaml（跟它已經在讀的 social_interactions.jsonl 同一份 NAS 存取權限），拿 person_id 換回 aliases 陣列的第一個當中文顯示名稱，一路送到卡片上；查不到對照的 id 才 fallback 顯示原始英文，不會壞掉',
      '刻意不在前端另外維護一份 person_id → 中文名字的複本——中文名字只有 people.yaml 這一份正確來源，兩邊各存一份遲早會失聯，所以選擇讓 collect.ps1 多讀一個它已經摸得到的檔案，而不是在 Aiportal 這邊手動謄一份',
    ],
  },
  {
    version: '1.35.0',
    date: '2026-08-31',
    summary: '社交指標新增計分對象名單；修正版本徽章手機排版',
    changes: [
      '社交指標卡片新增「計分對象（近 7 天）」——原本 collect.ps1 只把不重複人數（distinctPersonCount）送上伺服器，完整的 person_id 名單從來沒離開過 HERMES 主機；現在 collect.ps1／api-server／social_index_history 表／前端四邊都改成一起傳遞 person_id 陣列，卡片上直接列出這幾天被算進分數的對象',
      '版本徽章收合狀態不再把整行版本說明塞進按鈕——手機窄螢幕上原本會蓋住畫面中間的 3D MODE 按鈕、右邊的 ⚙ 齒輪，甚至超出螢幕邊緣。改成收合時只顯示版本號，完整說明搬進展開面板',
    ],
  },
  {
    version: '1.34.0',
    date: '2026-08-31',
    summary: '首頁改版：知識庫健康度併入 HERMES 戰情室、其餘區塊改可折疊、工具連結加搜尋',
    changes: [
      '知識庫健康度從心智指標卡片搬到 HERMES 戰情室，當作跟排程任務/近期活動/容器清單同一層級的第 4 個面板——兩者資料來源完全獨立，其中一個沒資料不擋住另一個',
      'HHI 六維度（人生自由/健身習慣/從容指數/旅遊生活/心智指標/社交指標）維持永遠展開，其餘區塊（HERMES 戰情室、工具連結）改成預設收合、點標題展開——首頁內容越堆越多，找特定資料越來越難找',
      '私領域純連結卡（例如 Duplicati 狀態）跟公領域合併成單一「工具連結」區塊，加上一個永遠可見的搜尋框，輸入關鍵字即時過濾兩邊的連結並自動展開',
    ],
  },
  {
    version: '1.33.0',
    date: '2026-08-21',
    summary: '翰翰仔幸福指數 v2：新增「社交指標」第六維度，心智指標改滾動窗口，旅遊生活加頻率與期待加分，權重全面調整',
    changes: [
      '新增社交指標（權重 13%）：全被動日記萃取，不用問卷——廣度（近 7 天不重複互動人數，5 人封頂）、互動強度（面對面/通話/訊息加權，見面分量最重）、連結率（有互動的天數佔觀測天數比例）三項合成，資料源自 HERMES 自己的 L1/L2 日記處理流程額外寫出的 social_interactions.jsonl（collect.ps1 只讀不寫）',
      '心智指標改成滾動 3 天窗口（今天+前 2 天日記篇數總和），不再每天歸零重算——原本每天歸零，寫日記較少的那天最弱項修正會把心智指標的有效權重放大到接近 30%，過度主導總分',
      '旅遊生活加入「頻率分」（180 天內累積行程天數，20 天封頂）跟「期待加分」（有已排定但還沒發生的行程 +5 分），不再只看距上次行程結束天數這單一維度',
      '六維權重全面調整：人生自由 31→27／健身習慣 20→18／生活從容 17→15／心智指標 17→15／旅遊生活 15→12／社交指標新增 13（最弱項修正 15% 與日對日平滑 70/30 不變）',
      '每日快照時機從「每次開頁面即時寫入歷史」改成 api-server 容器內常駐計時器固定 23:55（台北時間）觸發——23:55 之前卡片顯示的是即時重算、尚未寫入歷史的「今日暫定」值（有明確標籤），過了才凍結成當天最終分數，之後不再跳動，也不會被開頁面的時間點影響歷史紀錄',
    ],
  },
]

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface SiteLink {
  label: string
  url: string
}

interface SiteData {
  id: string
  name: string
  subtitle: string
  links: SiteLink[]
  worldXZ: [number, number]
  isPrivate: boolean
  subsystemId: string | null
}

interface DashboardSummary {
  subsystemId: string
  name: string
  isPrivate: boolean
  status: 'ok' | 'error' | 'pending'
  errorMessage: string | null
  fetchedAt: string | null
  data: Record<string, unknown> | null
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL ?? '/'

async function apiFetchSites(): Promise<SiteData[]> {
  const r = await fetch(`${API_BASE}api/sites`)
  if (!r.ok) throw new Error('Failed to fetch sites')
  const data = await r.json() as { sites: SiteData[] }
  return data.sites
}

async function apiFetchDashboard(adminPassword: string | null): Promise<{ summaries: DashboardSummary[]; unlocked: boolean }> {
  const r = await fetch(`${API_BASE}api/dashboard`, {
    headers: adminPassword ? { 'x-admin-password': adminPassword } : {},
  })
  if (!r.ok) throw new Error('Failed to fetch dashboard')
  return r.json() as Promise<{ summaries: DashboardSummary[]; unlocked: boolean }>
}

interface HappinessHistoryPoint {
  date: string
  finalScore: number
  displayedScore: number
  weakestComponent: string | null
}

async function apiFetchHappinessHistory(adminPassword: string, days = 30): Promise<HappinessHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch happiness history')
  const data = await r.json() as { history: HappinessHistoryPoint[] }
  return data.history
}

interface MindIndexHistoryPoint {
  date: string
  score: number
}

async function apiFetchMindIndexHistory(adminPassword: string, days = 30): Promise<MindIndexHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/mind-index/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch mind-index history')
  const data = await r.json() as { history: MindIndexHistoryPoint[] }
  return data.history
}

interface SocialIndexHistoryPoint {
  date: string
  socialScore: number
}

async function apiFetchSocialIndexHistory(adminPassword: string, days = 30): Promise<SocialIndexHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/social-index/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch social-index history')
  const data = await r.json() as { history: SocialIndexHistoryPoint[] }
  return data.history
}

interface HermesDiskInfo { drive: string; percentUsed: number; freeGb: number; totalGb: number }
interface HermesContainerInfo { name: string; project: string | null; status: string; health: string | null }
interface HermesScheduledTaskInfo { name: string; lastRunTime: string | null; lastTaskResult: number | null }

interface HermesStatusData {
  available: boolean
  cpuPercent: number | null
  memPercent: number | null
  disks: HermesDiskInfo[]
  containers: HermesContainerInfo[]
  scheduledTasks: HermesScheduledTaskInfo[]
  computedAt: string | null
  stale: boolean
}

async function apiFetchHermesStatus(adminPassword: string): Promise<HermesStatusData> {
  const r = await fetch(`${API_BASE}api/admin/hermes-status`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes status')
  return r.json() as Promise<HermesStatusData>
}

interface HermesActivityEntry { id: number; occurredAt: string; source: string; message: string }

async function apiFetchHermesActivity(adminPassword: string, limit = 20): Promise<HermesActivityEntry[]> {
  const r = await fetch(`${API_BASE}api/admin/hermes-activity?limit=${limit}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes activity')
  const data = await r.json() as { activity: HermesActivityEntry[] }
  return data.activity
}

async function apiVerifyPassword(password: string): Promise<boolean> {
  const r = await fetch(`${API_BASE}api/dashboard`, {
    headers: { 'x-admin-password': password },
  })
  if (!r.ok) return false
  const data = await r.json() as { unlocked: boolean }
  return data.unlocked === true
}

async function apiAddSite(data: Omit<SiteData, 'id'>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/admin/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to add site')
  return r.json() as Promise<SiteData>
}

async function apiUpdateSite(id: string, data: Partial<Omit<SiteData, 'id'>>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/admin/sites/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to update site')
  return r.json() as Promise<SiteData>
}

async function apiDeleteSite(id: string, adminPassword: string): Promise<void> {
  const r = await fetch(`${API_BASE}api/admin/sites/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to delete site')
}

// ─────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────
function formatTWD(n: number): string {
  return `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
}

function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '資料不足'
  const pct = n * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatMinutesAgo(iso: string | null): string {
  if (!iso) return '尚未取得'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return '剛剛更新'
  if (mins < 60) return `${mins} 分鐘前更新`
  return `${Math.round(mins / 60)} 小時前更新`
}

// ─────────────────────────────────────────────
// Score bands — thresholds/labels are domain logic (kept verbatim from the
// glass-card version); only the returned colors changed, from the old
// cyan/green/amber/orange/red palette to this palette's ok/warn/concern/crit
// semantic tones (kept separate from the amber accent per design system).
// ─────────────────────────────────────────────
function heroTone(score: number | null, invert: boolean): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  const s = invert ? 100 - score : score
  if (s >= 80) return { color: COLOR.ok, label: invert ? '輕鬆' : '優異' }
  if (s >= 50) return { color: COLOR.warn, label: '普通' }
  return { color: COLOR.crit, label: invert ? '緊繃' : '待加強' }
}

function hhiTone(score: number): { color: string; label: string } {
  if (score >= 80) return { color: COLOR.amber, label: '很幸福' }
  if (score >= 65) return { color: COLOR.ok, label: '穩定前進' }
  if (score >= 50) return { color: COLOR.warn, label: '尚可，需留意' }
  if (score >= 35) return { color: COLOR.concern, label: '需調整' }
  return { color: COLOR.crit, label: '警報，先照顧自己' }
}

type Band = [threshold: number, color: string, label: string]

function bandTone(score: number | null, bands: Band[]): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  for (const [threshold, color, label] of bands) {
    if (score >= threshold) return { color, label }
  }
  return { color: COLOR.steelDim, label: '資料不足' }
}

function pctTone(pct: number | null): string {
  if (pct === null) return COLOR.steelDim
  if (pct >= 90) return COLOR.crit
  if (pct >= 75) return COLOR.warn
  return COLOR.ok
}

const MIND_SCORE_BANDS: Band[] = [[80, COLOR.ok, '優良'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏弱'], [0, COLOR.crit, '停滯']]
const CONVERSION_BANDS: Band[] = [[90, COLOR.ok, '順暢'], [70, COLOR.warn, '普通'], [0, COLOR.crit, '淤積']]
const LINK_HEALTH_BANDS: Band[] = [[90, COLOR.ok, '緊密'], [75, COLOR.warn, '普通'], [0, COLOR.crit, '孤立']]
const VITALITY_BANDS: Band[] = [[80, COLOR.ok, '活躍'], [40, COLOR.warn, '普通'], [0, COLOR.crit, '停滯']]
const RHYTHM_BANDS: Band[] = [[80, COLOR.ok, '穩定'], [40, COLOR.warn, '普通'], [0, COLOR.crit, '低迷']]
const SOCIAL_SCORE_BANDS: Band[] = [[80, COLOR.ok, '熱絡'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏冷'], [0, COLOR.crit, '疏離']]

// ─────────────────────────────────────────────
// 30-day happiness insights — pure function over existing history data, no
// new schema/accumulation period needed (weakestComponent etc. was already
// being computed/stored daily, just never surfaced).
// ─────────────────────────────────────────────
interface HappinessInsights {
  weakestFrequency: { label: string; count: number; total: number } | null
  bestDay: { date: string; score: number } | null
  worstDay: { date: string; score: number } | null
  streak: { direction: 'up' | 'down'; days: number } | null
  weekdayPattern: { bestWeekday: string; bestAvg: number; worstWeekday: string; worstAvg: number } | null
  volatility: { stdDev: number; label: string } | null
}

function computeHappinessInsights(history: HappinessHistoryPoint[]): HappinessInsights {
  if (history.length === 0) {
    return { weakestFrequency: null, bestDay: null, worstDay: null, streak: null, weekdayPattern: null, volatility: null }
  }

  const weakestCounts = new Map<string, number>()
  let weakestTotal = 0
  for (const h of history) {
    if (h.weakestComponent) {
      weakestCounts.set(h.weakestComponent, (weakestCounts.get(h.weakestComponent) ?? 0) + 1)
      weakestTotal += 1
    }
  }
  let weakestFrequency: HappinessInsights['weakestFrequency'] = null
  if (weakestCounts.size > 0) {
    const [label, count] = [...weakestCounts.entries()].sort((a, b) => b[1] - a[1])[0]!
    weakestFrequency = { label, count, total: weakestTotal }
  }

  const byScore = [...history].sort((a, b) => a.displayedScore - b.displayedScore)
  const worstDay = { date: byScore[0]!.date, score: byScore[0]!.displayedScore }
  const bestDay = { date: byScore[byScore.length - 1]!.date, score: byScore[byScore.length - 1]!.displayedScore }

  const chronological = [...history].sort((a, b) => a.date.localeCompare(b.date))
  let streak: HappinessInsights['streak'] = null
  if (chronological.length >= 2) {
    let direction: 'up' | 'down' | null = null
    let days = 1
    for (let i = chronological.length - 1; i > 0; i--) {
      const diff = chronological[i]!.displayedScore - chronological[i - 1]!.displayedScore
      if (diff === 0) break
      const dir: 'up' | 'down' = diff > 0 ? 'up' : 'down'
      if (direction === null) { direction = dir; days = 2 }
      else if (dir === direction) { days += 1 }
      else break
    }
    if (direction !== null) streak = { direction, days }
  }

  const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  const weekdaySums = new Array<number>(7).fill(0)
  const weekdayCounts = new Array<number>(7).fill(0)
  for (const h of history) {
    const wd = new Date(`${h.date}T00:00:00`).getDay()
    weekdaySums[wd] += h.displayedScore
    weekdayCounts[wd] += 1
  }
  const weekdayAverages = weekdayNames
    .map((_, wd) => ({ wd, avg: weekdayCounts[wd]! > 0 ? weekdaySums[wd]! / weekdayCounts[wd]! : null, count: weekdayCounts[wd]! }))
    .filter((w): w is { wd: number; avg: number; count: number } => w.avg !== null && w.count >= 2)
  let weekdayPattern: HappinessInsights['weekdayPattern'] = null
  if (weekdayAverages.length >= 2) {
    const best = weekdayAverages.reduce((a, b) => (b.avg > a.avg ? b : a))
    const worst = weekdayAverages.reduce((a, b) => (b.avg < a.avg ? b : a))
    if (best.wd !== worst.wd) {
      weekdayPattern = {
        bestWeekday: weekdayNames[best.wd]!,
        bestAvg: Math.round(best.avg),
        worstWeekday: weekdayNames[worst.wd]!,
        worstAvg: Math.round(worst.avg),
      }
    }
  }

  let volatility: HappinessInsights['volatility'] = null
  if (history.length >= 3) {
    const mean = history.reduce((sum, h) => sum + h.displayedScore, 0) / history.length
    const variance = history.reduce((sum, h) => sum + (h.displayedScore - mean) ** 2, 0) / history.length
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10
    const label = stdDev < 5 ? '穩定' : stdDev < 12 ? '普通' : '起伏大'
    volatility = { stdDev, label }
  }

  return { weakestFrequency, bestDay, worstDay, streak, weekdayPattern, volatility }
}

// ─────────────────────────────────────────────
// Gauge — the signature instrument of the redesign. A 270° arc dial (90°
// gap at the bottom, like a real analog speedometer) with tick marks and a
// needle. `value` drives both the amber fill arc and the needle rotation;
// both sweep in from zero exactly once, on first mount (not on every data
// refresh) — driven by a `swept` flag that flips true ~100ms after mount,
// which the CSS transition on transform/stroke-dashoffset then animates.
// Respects prefers-reduced-motion by starting already-swept.
// ─────────────────────────────────────────────
const GAUGE_START = -135
const GAUGE_SWEEP = 270
const REDUCE_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function polarPoint(cx: number, cy: number, r: number, thetaDeg: number) {
  const rad = (thetaDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

function gaugeArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polarPoint(cx, cy, r, startDeg)
  const e = polarPoint(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

function Gauge({
  value,
  size = 'small',
  color = COLOR.amber,
  locked = false,
}: {
  value: number | null
  size?: 'primary' | 'small'
  color?: string
  locked?: boolean
}) {
  const [swept, setSwept] = useState(REDUCE_MOTION)
  useEffect(() => {
    if (REDUCE_MOTION) return
    const t = setTimeout(() => setSwept(true), 100)
    return () => clearTimeout(t)
  }, [])

  const isPrimary = size === 'primary'
  const dim = isPrimary ? 200 : 108
  const r = isPrimary ? 82 : 42
  const stroke = isPrimary ? 12 : 7
  const cx = dim / 2, cy = dim / 2
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value))
  const endAngle = GAUGE_START + (clamped / 100) * GAUGE_SWEEP
  const needleAngle = locked ? GAUGE_START : (swept ? endAngle : GAUGE_START)
  const dashOffset = swept ? 0 : 100
  const track = gaugeArcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)
  const valueArc = gaugeArcPath(cx, cy, r, GAUGE_START, endAngle)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const tAngle = GAUGE_START + (i / 10) * GAUGE_SWEEP
    const p1 = polarPoint(cx, cy, r + stroke / 2 + 3, tAngle)
    const p2 = polarPoint(cx, cy, r + stroke / 2 + (i % 5 === 0 ? 8 : 5), tAngle)
    return { key: i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  })

  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ flexShrink: 0, opacity: locked ? 0.4 : 1 }}>
      <path d={track} fill="none" stroke={COLOR.panelDeep} strokeWidth={stroke} strokeLinecap="round" />
      {!locked && (
        <path
          d={valueArc} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          pathLength={100} className="ip-arc-value"
          style={{ strokeDasharray: 100, strokeDashoffset: dashOffset }}
        />
      )}
      {ticks.map(t => (
        <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={COLOR.steelDim} strokeWidth={1} />
      ))}
      {!locked && (
        <>
          <line
            x1={cx} y1={cy} x2={cx} y2={cy - (r - stroke / 2 - 2)}
            stroke={COLOR.ink} strokeWidth={isPrimary ? 3 : 2} strokeLinecap="round"
            className="ip-needle"
            style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${needleAngle}deg)` }}
          />
          <circle cx={cx} cy={cy} r={isPrimary ? 5 : 3.5} fill={COLOR.ink} />
        </>
      )}
      <text
        x={cx} y={cy + r * 0.52} textAnchor="middle" fill={locked ? COLOR.steelDim : color}
        fontFamily={FONT.mono} fontWeight={600} fontSize={isPrimary ? 36 : 18}
      >
        {locked ? '🔒' : value !== null ? Math.round(value) : '—'}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────
// Panel primitives — shared instrument-housing chrome. Every section of the
// page is one `Unit` (a bezeled panel with an etched module label); cards
// within it share the same background/border tokens so the whole page reads
// as one panel, not a wall of unrelated widgets.
// ─────────────────────────────────────────────
function Unit({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{
      position: 'relative',
      background: `linear-gradient(180deg, ${COLOR.panelRaised}, ${COLOR.panel})`,
      border: `1px solid ${COLOR.line}`,
      borderRadius: '6px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.35)',
      padding: '1.6rem 1.7rem 1.5rem',
      marginBottom: '1.1rem',
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: '0.66rem', letterSpacing: '0.2em', textTransform: 'uppercase',
        color: COLOR.steelDim, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem',
      }}>
        <span style={{ color: COLOR.amberDim }}>{code}</span>
        <span style={{ fontFamily: FONT.body, fontSize: '0.72rem', letterSpacing: '0.08em', color: COLOR.steel, textTransform: 'none' }}>{title}</span>
        <span style={{ flex: 1, height: '1px', background: COLOR.line }} />
      </div>
      {children}
    </section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.6rem', fontFamily: FONT.mono }}>
      {children}
    </div>
  )
}

function LockedGaugeCard({ size = 'small', label, sub, onRequestUnlock }: { size?: 'primary' | 'small'; label: string; sub: string; onRequestUnlock: () => void }) {
  return (
    <div
      onClick={onRequestUnlock}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
        padding: size === 'primary' ? '0 0 0.5rem' : '1rem 0.6rem 0.9rem',
        background: size === 'primary' ? 'transparent' : COLOR.panelRaised,
        border: size === 'primary' ? 'none' : `1px solid ${COLOR.line}`,
        borderRadius: '5px', cursor: 'pointer',
      }}
    >
      <Gauge value={null} size={size} locked />
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink }}>{label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>{sub}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.warn, letterSpacing: '0.05em' }}>🔒 解鎖後顯示</div>
    </div>
  )
}

// Tap-to-expand formula detail — a footer toggle line, then a bordered panel
// of label/formula rows. Works identically on mouse and touch.
function FormulaToggle({
  expanded,
  onToggle,
  labelCollapsed = '公式說明 ▼',
  labelExpanded = '收起公式說明 ▲',
}: {
  expanded: boolean
  onToggle: (e: React.MouseEvent) => void
  labelCollapsed?: string
  labelExpanded?: string
}) {
  return (
    <div
      onClick={onToggle}
      style={{ marginTop: '0.6rem', textAlign: 'right', fontSize: '0.68rem', fontFamily: FONT.mono, color: COLOR.amberDim, cursor: 'pointer' }}
    >
      {expanded ? labelExpanded : labelCollapsed}
    </div>
  )
}

function SupportStats({ items }: { items: Array<{ label: string; value: string; color?: string; formula?: string; tier?: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem 2rem' }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, letterSpacing: '0.05em', marginBottom: '3px' }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: '1.05rem', fontWeight: 600, color: it.color ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{it.value}</span>
            {it.tier && <span style={{ fontSize: '0.66rem', fontWeight: 600, color: it.color }}>{it.tier}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function FormulaPanel({ rows }: { rows: Array<{ label: string; formula?: string }> }) {
  const withFormula = rows.filter((r): r is { label: string; formula: string } => !!r.formula)
  if (withFormula.length === 0) return null
  return (
    <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {withFormula.map(r => (
        <div key={r.label} style={{ fontSize: '0.68rem' }}>
          <div style={{ color: COLOR.steel, fontWeight: 600, marginBottom: '2px' }}>{r.label}</div>
          <div style={{ color: COLOR.steelDim, lineHeight: 1.6 }}>{r.formula}</div>
        </div>
      ))}
    </div>
  )
}

// Lightweight custom SVG line chart for 30-day trend panels — area fill +
// line + faint value labels, same instrument-mono treatment as the gauges.
function TrendLineChart({ points, color = COLOR.amber, height = 90 }: { points: Array<{ date: string; value: number }>; color?: string; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>
        還沒有足夠的歷史資料可畫趨勢線（目前 {points.length} 天，至少需要 2 天）——每天會自動多記一筆，過幾天回來看就有線了
      </div>
    )
  }

  const width = 100
  const values = points.map(p => p.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const padY = 6
  const innerH = height - padY * 2
  const stepX = width / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * stepX
    const y = padY + innerH - ((p.value - minV) / range) * innerH
    return [x, y] as const
  })
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]!
  const areaPath = `${linePath} L${last[0].toFixed(2)},${height} L0,${height} Z`

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={COLOR.line} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r={2} fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', fontFamily: FONT.mono, color: COLOR.steelDim, marginTop: '4px' }}>
        <span>{points[0]!.date}</span>
        <span>最低 {minV} · 最高 {maxV}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  )
}

// Shared radar chart — still the right chart for FitnessForge's 9 muscle
// axes (no single dial can show 9 independent balance axes at once).
// Absolute scale (0..maxValue), not self-relative — a self-relative chart
// always fills to 100% regardless of actual progress.
function LabeledRadarChart({
  axes,
  maxValue,
  baselineFraction,
  size = 240,
  color,
}: {
  axes: Array<{ label: string; value: number | null }>
  maxValue: number
  baselineFraction?: number
  size?: number
  color: string
}) {
  const cx = size / 2, cy = size / 2
  const r = size * 0.30
  const n = axes.length
  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pointAt = (i: number, radius: number) => [cx + radius * Math.cos(angleAt(i)), cy + radius * Math.sin(angleAt(i))] as const
  const ringPoints = (frac: number) => axes.map((_, i) => pointAt(i, r * frac)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const dataPoints = axes
    .map((a, i) => pointAt(i, r * (Math.max(0, Math.min(maxValue, a.value ?? 0)) / maxValue)))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, overflow: 'visible' }}>
      <polygon points={ringPoints(1)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      <polygon points={ringPoints(0.5)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      {baselineFraction !== undefined && (
        <polygon points={ringPoints(baselineFraction)} fill="none" stroke={COLOR.steel} strokeWidth={1.3} strokeDasharray="4 3" />
      )}
      {axes.map((_, i) => {
        const [x, y] = pointAt(i, r)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={COLOR.line} strokeWidth={1} />
      })}
      <polygon points={dataPoints} fill={`${color}33`} stroke={color} strokeWidth={2} />
      {axes.map((a, i) => {
        const ang = angleAt(i)
        const [x, y] = pointAt(i, r + 20)
        const cos = Math.cos(ang)
        const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fontFamily={FONT.body} fill={COLOR.steel}>
            {a.label}{a.value !== null ? ` ${Math.round(a.value)}` : ''}
          </text>
        )
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────
// Six-dimension summary bodies — one per HHI-contributing subsystem with a
// /api/public/summary source. Each returns just SupportStats + FormulaPanel
// now (the big number moved to the Gauge above it, replacing the old
// HeroIndex text). `expanded`/`onToggleExpand` were dead props left over
// from before formulas started showing unconditionally — dropped here.
// ─────────────────────────────────────────────
function PfCwhSummaryBody({ data }: { data: Record<string, unknown> }) {
  const totalAssetsTWD = typeof data['totalAssetsTWD'] === 'number' ? data['totalAssetsTWD'] : null
  const twrr = typeof data['twrr'] === 'number' ? data['twrr'] : null
  const mwrr = typeof data['mwrr'] === 'number' ? data['mwrr'] : null
  const pacingIndex = typeof data['pacingIndex'] === 'number' ? data['pacingIndex'] : null

  const items = [
    { label: '總資產', value: totalAssetsTWD !== null ? formatTWD(totalAssetsTWD) : '—', formula: '目前資產總市值（最新一筆快照）' },
    { label: 'TWRR', value: formatPct(twrr), color: twrr === null ? undefined : (twrr >= 0 ? COLOR.ok : COLOR.crit), formula: '時間加權報酬率——排除加減碼時機影響，純看資產本身的報酬表現' },
    { label: 'MWRR', value: formatPct(mwrr), color: mwrr === null ? undefined : (mwrr >= 0 ? COLOR.ok : COLOR.crit), formula: '金額加權報酬率——考慮加減碼金額與時機，反映實際到手的報酬' },
    { label: '休假配速', value: pacingIndex !== null ? `${Math.round(pacingIndex * 100)}%` : '—', formula: '休假進度 ÷ 年度時間進度，100% = 剛好照今年時間進度休假' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '人生自由指數', formula: '資產分／報酬分／休假配速分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均，不會整個是 0）' },
        ...items,
      ]} />
    </>
  )
}

const MUSCLE_GROUP_AXES = ['胸', '背', '腿', '肩', '二头肌', '核心', '臀', '三头肌', '有氧']

function FitnessForgeSummaryBody({ data }: { data: Record<string, unknown> }) {
  const weeklyScore = typeof data['weeklyScore'] === 'number' ? data['weeklyScore'] : null
  const trendPct = typeof data['trendPct'] === 'number' ? data['trendPct'] : null
  const balanceScore = typeof data['balanceScore'] === 'number' ? data['balanceScore'] : null
  const coverageScore = typeof data['coverageScore'] === 'number' ? data['coverageScore'] : null
  const activityBonusPoints = typeof data['activityBonusPoints'] === 'number' ? data['activityBonusPoints'] : 0
  const muscleComposites = Array.isArray(data['muscleComposites'])
    ? data['muscleComposites'] as Array<{ name: string; composite: number }>
    : []
  const radarAxes = MUSCLE_GROUP_AXES.map(name => ({
    label: name,
    value: muscleComposites.find(m => m.name === name)?.composite ?? null,
  }))

  const items = [
    { label: '本週積分', value: weeklyScore !== null ? weeklyScore.toLocaleString('zh-TW') : '—', formula: '本週各筆訓練紀錄的加權分數總和（原始累積量，未經配速調整）' },
    { label: '趨勢', value: trendPct !== null ? `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%` : '—', color: trendPct === null ? undefined : (trendPct >= 0 ? COLOR.ok : COLOR.crit), formula: '本週至今 vs 近 4 週同一段時間平均；平均基準太小或缺資料時，改比「目前配速 vs 個人平均配速」' },
    {
      label: '覆蓋率',
      value: coverageScore !== null ? `${coverageScore}%${activityBonusPoints > 0 ? `（含活動量 +${activityBonusPoints}%）` : ''}` : '—',
      formula: '本週肌群雷達圖多邊形面積 ÷ 每軸都達 100% 維持量時的面積，越高代表整體訓練量越飽滿；活動量（例如步數）另外加成，封頂 +10%',
    },
    { label: '均衡度', value: balanceScore !== null ? `${balanceScore}%` : '—', formula: '最弱肌群複合分 ÷ 最強肌群複合分（複合分 = 組數 40% + 容量 60%），數字越低代表落差越大' },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.6rem', alignItems: 'center' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <SupportStats items={items} />
        <FormulaPanel rows={[
          { label: '運動習慣指數', formula: '訓練量分／覆蓋分／均衡分／趨勢分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均）' },
          ...items,
        ]} />
      </div>
      <LabeledRadarChart axes={radarAxes} maxValue={150} baselineFraction={100 / 150} size={220} color={COLOR.amber} />
    </div>
  )
}

function VikunjaSummaryBody({ data }: { data: Record<string, unknown> }) {
  const overdueScore = typeof data['overdueScore'] === 'number' ? data['overdueScore'] : null
  const loadScore = typeof data['loadScore'] === 'number' ? data['loadScore'] : null
  const stagnationScore = typeof data['stagnationScore'] === 'number' ? data['stagnationScore'] : null
  const completionScore = typeof data['completionScore'] === 'number' ? data['completionScore'] : null

  const diagItem = (label: string, score: number | null, formula: string) => {
    const tone = heroTone(score, true)
    return { label, value: score !== null ? String(score) : '—', formula, color: score !== null ? tone.color : undefined, tier: score !== null ? tone.label : undefined }
  }

  const items = [
    diagItem('逾期壓力', overdueScore, '目前逾期任務的嚴重程度（數量、逾期天數），對比近三個月基準'),
    diagItem('近期負荷', loadScore, '近期任務負荷 ÷ 長期平均負荷（ACWR 概念），比值越高代表最近突然變忙'),
    diagItem('停滯程度', stagnationScore, '任務長期沒有進展、卡住不動的程度'),
    diagItem('拖延程度', completionScore, '過去 90 天準時完成率的反向指標（指數衰減加權，越近期權重越高），數字越高代表越常拖延'),
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '從容指數', formula: '100 － 忙碌指數（忙碌指數 = 逾期壓力／近期負荷／停滯程度／拖延程度四項加權平均，每天由 Python 服務算一次）。數字越高代表越從容' },
        ...items,
      ]} />
    </>
  )
}

function AdventureLogSummaryBody({ data }: { data: Record<string, unknown> }) {
  const daysSinceLastTrip = typeof data['daysSinceLastTrip'] === 'number' ? data['daysSinceLastTrip'] : null
  const lastTripEndDate = typeof data['lastTripEndDate'] === 'string' ? data['lastTripEndDate'] : null
  const recencyScore = typeof data['recencyScore'] === 'number' ? data['recencyScore'] : null
  const frequencyScore = typeof data['frequencyScore'] === 'number' ? data['frequencyScore'] : null
  const tripDaysLast180 = typeof data['tripDaysLast180'] === 'number' ? data['tripDaysLast180'] : null
  const anticipationBonus = typeof data['anticipationBonus'] === 'number' ? data['anticipationBonus'] : 0
  const hasUpcomingTrip = data['hasUpcomingTrip'] === true

  const items = [
    { label: '距上次旅行', value: daysSinceLastTrip !== null ? `${daysSinceLastTrip} 天` : '尚無紀錄', formula: '距離最近一次已結束行程的天數（還沒發生的計畫中行程不算）——換算成 recency 子分數' },
    { label: '最近一次行程結束', value: lastTripEndDate ? new Date(lastTripEndDate).toLocaleDateString('zh-TW') : '—', formula: 'AdventureLog 裡最近一筆已結束行程的結束日期' },
    { label: 'Recency 子分數', value: recencyScore !== null ? String(recencyScore) : '—', formula: '3 天內剛玩回來 = 100 分，之後線性遞減，約 93 天沒出去玩 = 0 分' },
    { label: 'Frequency 子分數', value: frequencyScore !== null ? String(frequencyScore) : '—', formula: `min(100, round(近 180 天累積行程天數 ÷ 20 × 100))${tripDaysLast180 !== null ? `（目前近 180 天累積 ${tripDaysLast180} 天）` : ''}` },
    { label: '期待加分', value: hasUpcomingTrip ? `+${anticipationBonus}` : '無', formula: '有已排定但還沒發生的行程 +5 分（開關預設開啟）' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '旅遊生活（HHI v2）', formula: 'travelScore = clamp(round(0.5 × Recency + 0.5 × Frequency) + 期待加分, 0, 100)——要維持一定的整體旅遊頻率，不是只看距上次旅行天數' },
        ...items,
      ]} />
    </>
  )
}

const SUMMARY_BODIES: Record<string, (props: { data: Record<string, unknown> }) => React.ReactElement> = {
  'pf-cwh': PfCwhSummaryBody,
  'fitnessforge': FitnessForgeSummaryBody,
  'travel': AdventureLogSummaryBody,
  'vikunja': VikunjaSummaryBody,
}

const DIMENSION_HERO_FIELD: Record<string, string> = {
  'pf-cwh': 'lifeFreedomIndex',
  'fitnessforge': 'habitIndex',
  'vikunja': 'busyIndex', // raw, uninverted — shown as "原始分數" detail only
  'travel': 'travelScore',
}

// HHI v3 (2026-09-01) — the six dimensions come from four independently
// designed formulas with wildly different shapes (see happinessIndex.ts's
// percentile normalization comment), so "80" meant something different in
// every dial. The gauges now show each dimension's percentile rank against
// its own trailing 90-day history (from the "hhi" summary, already
// normalized server-side), not the raw formula output — the raw number
// moves to the "詳細數據" panel below instead.
const DIMENSION_NORMALIZED_FIELD: Record<string, string> = {
  'pf-cwh': 'lifeFreedomScore',
  'fitnessforge': 'fitnessHabitScore',
  'vikunja': 'calmScore', // already inverted+normalized — higher = calmer
  'travel': 'travelScore',
}

const DIMENSION_SUB: Record<string, string> = {
  'pf-cwh': '人生自由',
  'fitnessforge': '運動習慣',
  'vikunja': '從容指數',
  'travel': '旅遊生活',
}

// Replaces GlassSummaryCard — one gauge tile per HHI-contributing subsystem
// that has a portal_sites row (pf-cwh/fitnessforge/vikunja/travel). Vikunja
// is special-cased: the API's busyIndex is "higher = busier", displayed
// inverted as a calm index so all six dials share "higher = better".
function DimensionGauge({
  site,
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  site: SiteData
  summary: DashboardSummary
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const isLocked = site.isPrivate && !unlocked
  const [expanded, setExpanded] = useState(false)
  const Body = SUMMARY_BODIES[summary.subsystemId]
  const data = summary.data
  const rawHero = data && typeof data[DIMENSION_HERO_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? data[DIMENSION_HERO_FIELD[summary.subsystemId]!] as number
    : null
  const hhiData = hhiSummary?.data
  const normalizedScore = hhiData && typeof hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId]!] as number
    : null
  const tone = normalizedScore !== null ? heroTone(normalizedScore, false) : { color: COLOR.steelDim, label: '資料不足' }

  if (isLocked) {
    return <LockedGaugeCard label={site.name} sub={site.subtitle || DIMENSION_SUB[summary.subsystemId] || ''} onRequestUnlock={() => onSelect(site)} />
  }

  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
        padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
      }}
    >
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink, textAlign: 'center' }}>{site.name}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, letterSpacing: '0.04em' }}>
        {normalizedScore !== null ? tone.label : (summary.status === 'pending' ? '資料準備中' : '暫時無法取得資料')}
      </div>
      {Body && data && (
        <div style={{ width: '100%', marginTop: '0.3rem' }} onClick={e => e.stopPropagation()}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
                原始分數（未正規化）：{rawHero !== null ? rawHero : '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
              </div>
              <Body data={data} />
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: '0.5rem', marginTop: '0.2rem', borderTop: `1px solid ${COLOR.line}`, fontFamily: FONT.mono, fontSize: '0.6rem' }}>
        <span style={{ color: COLOR.steelDim }}>{formatMinutesAgo(summary.fetchedAt)}</span>
        <span style={{ color: COLOR.amberDim, letterSpacing: '0.03em' }}>前往系統 ↗</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 心智指標 — dailyEngagementScore (計入 HHI, 純看近 3 天日記篇數滾動總和)。
// 知識庫健康度（原本這張卡片唯一的內容）已搬到 HERMES 戰情室當獨立面板，
// 見 HermesKnowledgeHealthPanel。
// ─────────────────────────────────────────────
function MindIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const data = summary?.data
  const dailyEngagementScore = typeof data?.['dailyEngagementScore'] === 'number' ? data['dailyEngagementScore'] as number : null
  const diaryEntryCount = typeof data?.['diaryEntryCount'] === 'number' ? data['diaryEntryCount'] as number : null
  const stale = data?.['stale'] === true
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['mindScore'] === 'number' ? hhiSummary.data['mindScore'] as number : null
  const tone = bandTone(normalizedScore, MIND_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label="心智指標" sub="日記書寫" onRequestUnlock={onSelect} />
  }

  const engagementItems = [
    { label: '日記篇數（今天）', value: diaryEntryCount !== null ? String(diaryEntryCount) : '—', formula: '今天的日記篇數，計分實際用的是近 3 天滾動總和' },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>心智指標</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {normalizedScore !== null ? tone.label : (summary?.status === 'error' ? '暫時無法取得資料' : '資料準備中')}
      </div>
      {stale && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      <div style={{ width: '100%', marginTop: '0.3rem' }}>
        <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
        {expanded && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
              原始分數（未正規化）：{dailyEngagementScore ?? '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
            </div>
            <SupportStats items={engagementItems} />
            <FormulaPanel rows={[
              { label: '心智指標（計入幸福指數，HHI v2 滾動 3 天窗口）', formula: 'dailyEngagementScore = round(100 × 近 3 天篇數總和 ÷ (近 3 天篇數總和 + 10))' },
              ...engagementItems,
            ]} />
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 社交指標 (HHI v2) — 全被動日記萃取，資料來源是 social_interactions.jsonl。
// ─────────────────────────────────────────────
function SocialIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const data = summary?.data
  const observedDayCount = typeof data?.['observedDayCount'] === 'number' ? data['observedDayCount'] as number : null
  const distinctPersonCount = typeof data?.['distinctPersonCount'] === 'number' ? data['distinctPersonCount'] as number : null
  const daysWithInteraction = typeof data?.['daysWithInteraction'] === 'number' ? data['daysWithInteraction'] as number : null
  const breadthScore = typeof data?.['breadthScore'] === 'number' ? data['breadthScore'] as number : null
  const intensityScore = typeof data?.['intensityScore'] === 'number' ? data['intensityScore'] as number : null
  const connectionRateScore = typeof data?.['connectionRateScore'] === 'number' ? data['connectionRateScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const personNamesRaw = data?.['personNames']
  const personNames = Array.isArray(personNamesRaw) ? personNamesRaw.filter((v): v is string => typeof v === 'string') : null
  const stale = data?.['stale'] === true
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['socialScore'] === 'number' ? hhiSummary.data['socialScore'] as number : null
  const tone = bandTone(normalizedScore, SOCIAL_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label="社交指標" sub="近 7 天社交活動" onRequestUnlock={onSelect} />
  }

  const socialItems = [
    { label: '廣度', value: breadthScore !== null ? String(breadthScore) : '—', formula: 'min(100, 近 7 天不重複互動人數 × 20)——5 人封頂' },
    { label: '互動強度', value: intensityScore !== null ? String(intensityScore) : '—', formula: 'min(100, round(近 7 天加權互動點數 ÷ 15 × 100))——見面 3 點／通話 2 點／訊息 1 點' },
    { label: '連結率', value: connectionRateScore !== null ? String(connectionRateScore) : '—', formula: 'round(近 7 天有互動的觀測日數 ÷ 近 7 天觀測日數 × 100)' },
    { label: '觀測日／互動天數', value: observedDayCount !== null ? `${daysWithInteraction ?? 0} / ${observedDayCount}` : '—', formula: '觀測日＝當天有寫日記（≥1 篇）' },
  ]

  const showEmpty = observedDayCount === null || observedDayCount === 0 || socialScore === null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>社交指標</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {showEmpty ? (summary?.status === 'error' ? '暫時無法取得資料' : '近 7 天沒有日記可供觀測') : tone.label}
      </div>
      {stale && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      {distinctPersonCount === 0 && !showEmpty && (
        <div style={{ fontSize: '0.62rem', color: COLOR.steel, textAlign: 'center' }}>這幾天有寫日記，但沒有社交互動紀錄——真實的 0 分</div>
      )}
      {personNames && personNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', marginTop: '0.2rem' }}>
          {personNames.map(name => (
            <span key={name} style={{ fontSize: '0.62rem', color: COLOR.steel, background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '2px 8px' }}>{name}</span>
          ))}
        </div>
      )}
      {!showEmpty && (
        <div style={{ width: '100%', marginTop: '0.3rem' }}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
                原始分數（未正規化）：{socialScore ?? '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
              </div>
              <SupportStats items={socialItems} />
              <FormulaPanel rows={[
                { label: '社交指標（計入幸福指數）', formula: 'socialScore = round(0.40 × 廣度 + 0.40 × 互動強度 + 0.20 × 連結率)' },
                ...socialItems,
              ]} />
            </div>
          )}
        </div>
      )}
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 翰翰仔幸福指數 (Hanhan Happiness Index) — the primary instrument.
// ─────────────────────────────────────────────
function HappinessHeroCard({
  summary,
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  summary: DashboardSummary | undefined
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<HappinessHistoryPoint[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const isLocked = !unlocked

  useEffect(() => {
    if (!unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchHappinessHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword, history])

  const data = summary?.data
  const displayedScore = typeof data?.['displayedScore'] === 'number' ? data['displayedScore'] as number : null
  const baseScore = typeof data?.['baseScore'] === 'number' ? data['baseScore'] as number : null
  const weakestScore = typeof data?.['weakestScore'] === 'number' ? data['weakestScore'] as number : null
  const finalScore = typeof data?.['finalScore'] === 'number' ? data['finalScore'] as number : null
  const weakestComponent = typeof data?.['weakestComponent'] === 'string' ? data['weakestComponent'] as string : null
  const lifeFreedomScore = typeof data?.['lifeFreedomScore'] === 'number' ? data['lifeFreedomScore'] as number : null
  const fitnessHabitScore = typeof data?.['fitnessHabitScore'] === 'number' ? data['fitnessHabitScore'] as number : null
  const calmScore = typeof data?.['calmScore'] === 'number' ? data['calmScore'] as number : null
  const mindScore = typeof data?.['mindScore'] === 'number' ? data['mindScore'] as number : null
  const travelScore = typeof data?.['travelScore'] === 'number' ? data['travelScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const usingStaleData = data?.['usingStaleData'] === true
  const isSnapshotFinal = data?.['isSnapshotFinal'] === true
  const weights = data?.['weights'] as { lifeFreedomWeight?: number; fitnessWeight?: number; calmWeight?: number; mindWeight?: number; travelWeight?: number; socialWeight?: number } | undefined

  if (isLocked) {
    return <LockedGaugeCard size="primary" label="翰翰仔幸福指數" sub="Hanhan Happiness Index" onRequestUnlock={onRequestUnlock} />
  }

  if (!data || displayedScore === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={null} size="primary" />
        <div style={{ fontSize: '0.85rem', color: COLOR.steelDim }}>資料準備中…</div>
      </div>
    )
  }

  const tone = hhiTone(displayedScore)
  const contributions: Array<{ label: string; value: number | null; weightPct: number }> = [
    { label: '人生自由', value: lifeFreedomScore, weightPct: Math.round((weights?.lifeFreedomWeight ?? 0.27) * 100) },
    { label: '健身習慣', value: fitnessHabitScore, weightPct: Math.round((weights?.fitnessWeight ?? 0.18) * 100) },
    { label: '生活從容', value: calmScore, weightPct: Math.round((weights?.calmWeight ?? 0.15) * 100) },
    { label: '心智指標', value: mindScore, weightPct: Math.round((weights?.mindWeight ?? 0.15) * 100) },
    { label: '社交指標', value: socialScore, weightPct: Math.round((weights?.socialWeight ?? 0.13) * 100) },
    { label: '旅遊生活', value: travelScore, weightPct: Math.round((weights?.travelWeight ?? 0.12) * 100) },
  ]
  const radarAxes = contributions.map(c => ({ label: c.label, value: c.value }))

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2rem', alignItems: 'center' }} className="ip-primary-grid">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
          <Gauge value={displayedScore} size="primary" color={tone.color} />
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: tone.color }}>{tone.label}</div>
          {!isSnapshotFinal && (
            <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.warn, border: `1px solid ${COLOR.warn}`, borderRadius: '999px', padding: '1px 8px' }}>今日暫定</span>
          )}
        </div>
        <LabeledRadarChart axes={radarAxes} maxValue={100} size={230} color={tone.color} />
      </div>

      {/* 權重佔比——雷達圖只畫得出分數，這行補上每個維度實際佔幸福指數的
          百分比，雷達圖看不出來的資訊。 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', justifyContent: 'center', marginTop: '1rem', fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
        {contributions.map(c => (
          <span key={c.label}>{c.label} <span style={{ color: COLOR.steel }}>{c.weightPct}%</span></span>
        ))}
      </div>

      {weakestComponent && (
        <div style={{ fontSize: '0.78rem', color: COLOR.steel, marginTop: '1rem' }}>
          目前最需要照顧：<span style={{ color: COLOR.warn, fontWeight: 600 }}>{weakestComponent}</span>
        </div>
      )}

      {history !== null && history.length > 0 && (() => {
        const insights = computeHappinessInsights(history)
        const rows: string[] = []
        if (insights.weakestFrequency) {
          rows.push(`最常見短板：${insights.weakestFrequency.label}（${insights.weakestFrequency.count}/${insights.weakestFrequency.total} 天）`)
        }
        if (insights.bestDay && insights.worstDay && insights.bestDay.date !== insights.worstDay.date) {
          rows.push(`最高 ${insights.bestDay.date}（${insights.bestDay.score} 分）· 最低 ${insights.worstDay.date}（${insights.worstDay.score} 分）`)
        }
        if (insights.streak && insights.streak.days >= 2) {
          rows.push(`連續 ${insights.streak.days} 天${insights.streak.direction === 'up' ? '上升' : '下降'}`)
        }
        if (insights.weekdayPattern) {
          rows.push(`${insights.weekdayPattern.bestWeekday}通常最高（${insights.weekdayPattern.bestAvg} 分）· ${insights.weekdayPattern.worstWeekday}通常最低（${insights.weekdayPattern.worstAvg} 分）`)
        }
        if (insights.volatility) {
          rows.push(`波動度：${insights.volatility.label}（標準差 ${insights.volatility.stdDev}）`)
        }
        if (rows.length === 0) return null
        return (
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: `1px solid ${COLOR.line}` }}>
            <SubLabel>近 30 天洞察</SubLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rows.map(r => <div key={r} style={{ fontSize: '0.76rem', color: COLOR.steel, lineHeight: 1.6 }}>{r}</div>)}
            </div>
          </div>
        )
      })()}

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          ['基礎分（加權平均）', baseScore !== null ? baseScore.toFixed(2) : '—'],
          ['最弱項分數', weakestScore !== null ? weakestScore.toFixed(2) : '—'],
          ['短板修正後（平滑前）', finalScore !== null ? String(finalScore) : '—'],
          ['平滑後（目前顯示值）', String(displayedScore)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
            <span style={{ color: COLOR.steelDim }}>{label}</span>
            <span style={{ color: COLOR.steel, fontWeight: 500, fontFamily: FONT.mono }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.7rem', marginTop: '0.8rem', borderTop: `1px solid ${COLOR.line}` }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
          {formatMinutesAgo(summary?.fetchedAt ?? null)}
          {usingStaleData ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 部分資料為最近可用值</span> : null}
        </span>
        <span onClick={() => setExpanded(x => !x)} style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.amberDim, cursor: 'pointer' }}>
          {expanded ? '收起趨勢圖 ▲' : '歷史趨勢圖 ▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.6rem', paddingTop: '0.8rem', borderTop: `1px dashed ${COLOR.line}` }}>
          <SubLabel>近 30 天趨勢（每日顯示值）</SubLabel>
          {historyError ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>趨勢資料讀取失敗</div>
          ) : history === null ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>載入中…</div>
          ) : (
            <TrendLineChart points={history.map(h => ({ date: h.date, value: h.displayedScore }))} color={tone.color} />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// HERMES 戰情室 — operational monitoring, collected by
// services/hermes-status/collect.ps1 and POSTed to /api/admin/hermes-status
// + /api/admin/hermes-activity. Not a happiness dimension.
// ─────────────────────────────────────────────
function formatGb(n: number): string {
  return `${n.toFixed(1)} GB`
}

function StatCell({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ background: COLOR.panelRaised, padding: '0.85rem 1rem' }}>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: COLOR.steelDim, marginBottom: '0.35rem', display: 'block' }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: '1.3rem', fontWeight: 600, color: valueColor ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function SubPanel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '1rem 1.1rem',
    }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLOR.ink, marginBottom: '2px' }}>{title}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginBottom: '0.7rem' }}>{sub}</div>
      {children}
    </div>
  )
}

function HermesKnowledgeHealthPanel({
  summary,
  unlockedPassword,
}: {
  summary: DashboardSummary | undefined
  unlockedPassword: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<MindIndexHistoryPoint[] | null>(null)
  const [historyError, setHistoryError] = useState(false)

  useEffect(() => {
    if (!expanded || !unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchMindIndexHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [expanded, unlockedPassword, history])

  const data = summary?.data
  const score = typeof data?.['score'] === 'number' ? data['score'] as number : null
  const conversion = typeof data?.['conversion'] === 'number' ? data['conversion'] as number : null
  const linkHealth = typeof data?.['linkHealth'] === 'number' ? data['linkHealth'] as number : null
  const vitality = typeof data?.['vitality'] === 'number' ? data['vitality'] as number : null
  const rhythm = typeof data?.['rhythm'] === 'number' ? data['rhythm'] as number : null
  const partial = data?.['partial'] === true

  const oldTone = bandTone(score, MIND_SCORE_BANDS)
  const conversionTone = bandTone(conversion, CONVERSION_BANDS)
  const linkHealthTone = bandTone(linkHealth, LINK_HEALTH_BANDS)
  const vitalityTone = bandTone(vitality, VITALITY_BANDS)
  const rhythmTone = bandTone(rhythm, RHYTHM_BANDS)
  const knowledgeItems = [
    { label: '轉化率', value: conversion !== null ? String(conversion) : '—', color: conversionTone.color, tier: conversion !== null ? conversionTone.label : undefined, formula: 'CREATE 層：100 × 近30天編譯進 wiki 的條目數 ÷ (近30天編譯數 + inbox 超過7天未編譯的積壓數)' },
    { label: '連結健康度', value: linkHealth !== null ? String(linkHealth) : '—', color: linkHealthTone.color, tier: linkHealth !== null ? linkHealthTone.label : undefined, formula: 'ENRICH 層：100 × (1 − 孤兒條目數 ÷ 總條目數)' },
    { label: '活化度', value: vitality !== null ? String(vitality) : '—', color: vitalityTone.color, tier: vitality !== null ? vitalityTone.label : undefined, formula: 'SYNTHESIZE 層：min(100, 近30天被修改條目比例 × 400)' },
    { label: '本週節奏', value: rhythm !== null ? String(rhythm) : '—', color: rhythmTone.color, tier: rhythm !== null ? rhythmTone.label : undefined, formula: '近7天加權積分 ÷ 30 × 100' },
  ]

  return (
    <SubPanel title="知識庫健康度" sub="HERMES Knowledge Base · 不計入幸福指數">
      {score === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>
          {summary?.status === 'error' ? '暫時無法取得資料' : '資料準備中…'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '0.9rem' }}>
            <div style={{ fontFamily: FONT.mono, fontSize: '1.7rem', fontWeight: 700, lineHeight: 1, color: oldTone.color }}>{score}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: oldTone.color }}>{oldTone.label}</div>
            {partial && <span style={{ fontSize: '0.66rem', color: COLOR.warn }}>部分子分數缺項</span>}
          </div>
          <SupportStats items={knowledgeItems} />
          <FormulaPanel rows={[
            { label: '知識庫健康度', formula: 'score = round((轉化率 × 連結健康度 × 活化度 × 本週節奏) ^ 0.25)，幾何平均' },
            ...knowledgeItems,
          ]} />
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="歷史趨勢 ▼" labelExpanded="收起歷史趨勢 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: `1px dashed ${COLOR.line}` }}>
              {historyError ? (
                <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>趨勢資料讀取失敗</div>
              ) : history === null ? (
                <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>載入中…</div>
              ) : (
                <TrendLineChart points={history.map(h => ({ date: h.date, value: h.score }))} color={oldTone.color} height={70} />
              )}
            </div>
          )}
        </>
      )}
    </SubPanel>
  )
}

const TASK_RUNNING_RESULT = 267009 // 0x41301 SCHED_S_TASK_RUNNING
const TASK_NOT_YET_RUN_RESULT = 267011 // 0x41303 SCHED_S_TASK_HAS_NOT_RUN

function HermesTaskRow({ name, lastRunTime, lastTaskResult }: HermesScheduledTaskInfo) {
  const isRunning = lastTaskResult === TASK_RUNNING_RESULT
  const isPending = lastTaskResult === TASK_NOT_YET_RUN_RESULT
  const isFailed = lastTaskResult !== null && !isRunning && !isPending && lastTaskResult !== 0
  const dotClass = isRunning ? 'dot-run' : isFailed ? 'dot-warn' : 'dot-ok'
  const statusSuffix = isRunning ? ' · 執行中' : isPending ? ' · 尚未觸發過' : isFailed ? ` · 失敗 (${lastTaskResult})` : ''
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>
        {lastRunTime ? formatMinutesAgo(lastRunTime) : '尚未執行'}{statusSuffix}
      </span>
    </div>
  )
}

function HermesActivityRow({ occurredAt, source, message }: HermesActivityEntry) {
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0 }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>{source}</span> {message}
      </span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{formatMinutesAgo(occurredAt)}</span>
    </div>
  )
}

function HermesContainerRow({ name, status, health }: HermesContainerInfo) {
  const isFailed = !/up/i.test(status)
  const isUnhealthy = health === 'unhealthy'
  const dotClass = isFailed || isUnhealthy ? 'dot-warn' : 'dot-ok'
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{status}{health ? ` · ${health}` : ''}</span>
    </div>
  )
}

function HermesWarRoomSection({
  unlocked,
  unlockedPassword,
  onRequestUnlock,
  mindSummary,
}: {
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
  mindSummary: DashboardSummary | undefined
}) {
  const [status, setStatus] = useState<HermesStatusData | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [activity, setActivity] = useState<HermesActivityEntry[] | null>(null)
  const [activityError, setActivityError] = useState(false)

  useEffect(() => {
    if (!unlocked || !unlockedPassword) return
    let cancelled = false
    apiFetchHermesStatus(unlockedPassword)
      .then(d => { if (!cancelled) setStatus(d) })
      .catch(() => { if (!cancelled) setStatusError(true) })
    apiFetchHermesActivity(unlockedPassword)
      .then(d => { if (!cancelled) setActivity(d) })
      .catch(() => { if (!cancelled) setActivityError(true) })
    return () => { cancelled = true }
  }, [unlocked, unlockedPassword])

  if (!unlocked) {
    return (
      <div onClick={onRequestUnlock} style={{ cursor: 'pointer', padding: '1rem 0.2rem' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.warn }}>🔒 解鎖後顯示</div>
      </div>
    )
  }

  const availableStatus: HermesStatusData | null = !statusError && status && status.available ? status : null

  return (
    <div>
      {availableStatus === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '1rem 0.2rem' }}>
          {statusError ? 'HERMES 戰情室：暫時無法取得資料' : 'HERMES 戰情室：尚無資料，collect.ps1 還沒在主機上跑過'}
        </div>
      ) : (
        <div style={{ opacity: availableStatus.stale ? 0.55 : 1, filter: availableStatus.stale ? 'saturate(0.5)' : undefined }}>
          {(() => {
            const worstDisk = availableStatus.disks.reduce<HermesDiskInfo | null>(
              (worst, d) => (!worst || d.percentUsed > worst.percentUsed ? d : worst), null,
            )
            const containersOk = availableStatus.containers.filter(c => /up/i.test(c.status) && c.health !== 'unhealthy').length
            return (
              <div className="ip-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginBottom: '0.9rem' }}>
                <StatCell label="CPU 負載" value={availableStatus.cpuPercent !== null ? `${Math.round(availableStatus.cpuPercent)}%` : '—'} valueColor={pctTone(availableStatus.cpuPercent)} />
                <StatCell label="記憶體" value={availableStatus.memPercent !== null ? `${Math.round(availableStatus.memPercent)}%` : '—'} valueColor={pctTone(availableStatus.memPercent)} />
                <StatCell
                  label={worstDisk ? `磁碟 ${worstDisk.drive}` : '磁碟'}
                  value={worstDisk ? `${Math.round(worstDisk.percentUsed)}%` : '—'}
                  sub={worstDisk ? `剩餘 ${formatGb(worstDisk.freeGb)}` : undefined}
                  valueColor={worstDisk ? pctTone(worstDisk.percentUsed) : undefined}
                />
                <StatCell
                  label="容器健康"
                  value={`${containersOk} / ${availableStatus.containers.length}`}
                  sub={availableStatus.containers.length > 0 && containersOk < availableStatus.containers.length ? '有容器異常' : undefined}
                  valueColor={containersOk < availableStatus.containers.length ? COLOR.warn : COLOR.ok}
                />
              </div>
            )
          })()}

          <div className="ip-board-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
            <SubPanel title="排程任務狀態" sub="Windows Task Scheduler · 最近執行">
              {availableStatus.scheduledTasks.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無排程任務資料</div>
                : availableStatus.scheduledTasks.map(t => <HermesTaskRow key={t.name} {...t} />)}
            </SubPanel>
            <SubPanel title="近期活動" sub="部署 / 備份紀錄">
              {activityError
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>活動紀錄讀取失敗</div>
                : activity === null
                  ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
                  : activity.length === 0
                    ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無活動紀錄</div>
                    : activity.map(a => <HermesActivityRow key={a.id} {...a} />)}
            </SubPanel>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <SubPanel title="容器清單" sub="Docker · 目前執行狀態">
              {availableStatus.containers.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無容器資料</div>
                : availableStatus.containers.map(c => <HermesContainerRow key={c.name} {...c} />)}
            </SubPanel>
          </div>

          <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '0.7rem', textAlign: 'right' }}>
            {availableStatus.computedAt ? formatMinutesAgo(availableStatus.computedAt) : ''}
            {availableStatus.stale ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 資料已超過 30 分鐘未更新</span> : null}
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.9rem' }}>
        <HermesKnowledgeHealthPanel summary={mindSummary} unlockedPassword={unlockedPassword} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 工具連結 — private plain-link sites (no dashboard summary) merged with all
// public sites into one searchable, collapsible control panel.
// ─────────────────────────────────────────────
function SwitchTile({ site, unlocked, onSelect }: { site: SiteData; unlocked: boolean; onSelect: (site: SiteData) => void }) {
  const isLocked = site.isPrivate && !unlocked
  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        position: 'relative', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.8rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
      }}
    >
      <span style={{
        width: '24px', height: '13px', borderRadius: '7px', background: COLOR.panelDeep, border: `1px solid ${COLOR.lineBright}`,
        position: 'relative', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: '1px', width: '9px', height: '9px', borderRadius: '50%',
          background: isLocked ? COLOR.steelDim : (site.isPrivate ? COLOR.amber : COLOR.ok),
          boxShadow: isLocked ? 'none' : `0 0 5px ${site.isPrivate ? COLOR.amber : COLOR.ok}`,
          left: isLocked ? '1px' : '10px', transition: 'left 0.15s',
        }} />
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.76rem', color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isLocked && '🔒 '}{site.name}
      </span>
    </div>
  )
}

function ToolLinksZone({
  privateSites,
  publicSites,
  unlocked,
  onSelect,
}: {
  privateSites: SiteData[]
  publicSites: SiteData[]
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const searchActive = q.length > 0
  const matches = (s: SiteData) => !searchActive || s.name.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q)
  const filteredPrivate = privateSites.filter(matches)
  const filteredPublic = publicSites.filter(matches)
  const total = privateSites.length + publicSites.length
  const totalMatched = filteredPrivate.length + filteredPublic.length
  const isOpen = open || searchActive

  return (
    <Unit code="04" title="工具連結 · Control Panel">
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '1rem', marginTop: '-0.4rem' }}
      >
        <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: COLOR.amberDim, fontSize: '0.8rem' }}>▶</span>
        <span style={{ fontSize: '0.78rem', color: COLOR.steel }}>{isOpen ? '收起連結列表' : '展開連結列表'}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.steelDim }}>{searchActive ? `${totalMatched} / ${total}` : `${total} 個`}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px', padding: '0.55rem 0.9rem', marginBottom: '1.1rem' }}>
        <span style={{ color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.85rem' }}>◎</span>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋工具名稱…" autoComplete="off"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.9rem' }}
        />
      </div>

      {isOpen && (
        <>
          {filteredPrivate.length > 0 && (
            <div style={{ marginBottom: '1.1rem' }}>
              <SubLabel>私領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPrivate.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} />)}
              </div>
            </div>
          )}
          {filteredPublic.length > 0 && (
            <div>
              <SubLabel>公領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPublic.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} />)}
              </div>
            </div>
          )}
          {searchActive && totalMatched === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>找不到符合「{query}」的工具</div>
          )}
          {!searchActive && total === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>No Data</div>
          )}
        </>
      )}
    </Unit>
  )
}

// ─────────────────────────────────────────────
// Password / Admin dialogs — same structure/logic as before, restyled to
// the instrument-panel palette.
// ─────────────────────────────────────────────
function PasswordModal({
  pendingUrl,
  onSuccess,
  onCancel,
}: {
  pendingUrl: string
  onSuccess: (password: string) => void
  onCancel: () => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      localStorage.setItem(UNLOCK_KEY, input)
      if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener,noreferrer')
      onSuccess(input)
    } else {
      setError('密碼錯誤，請再試一次')
      setInput('')
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2.2rem 2.4rem', width: '340px', color: COLOR.ink, fontFamily: FONT.body, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '14px' }}>🔒 私領域網站</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '8px' }}>輸入密碼</div>
        <div style={{ fontSize: '0.75rem', color: COLOR.steelDim, marginBottom: '1.6rem', lineHeight: 1.6 }}>此為私領域網站，請輸入密碼以繼續。<br />本裝置驗證後將不再詢問。</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input
            type="password" value={input} autoFocus placeholder="••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{
              width: '100%', padding: '0.7rem 0.9rem', background: COLOR.panelDeep,
              border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink,
              fontSize: '0.9rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em',
            }}
          />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.65rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '確認進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputSt: React.CSSProperties = {
  padding: '0.55rem 0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px',
  color: COLOR.ink, fontSize: '0.8rem', fontFamily: FONT.body, outline: 'none', boxSizing: 'border-box', width: '100%',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  )
}

const BLANK_FORM = (): Omit<SiteData, 'id' | 'worldXZ'> => ({
  name: '', subtitle: '', links: [{ label: '進入系統', url: '' }], isPrivate: false, subsystemId: null,
})

interface AdminPanelProps {
  sites: SiteData[]
  adminPassword: string
  onAdd: (data: Omit<SiteData, 'id'>) => Promise<void>
  onEdit: (id: string, data: Partial<Omit<SiteData, 'id'>>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

function AdminPanel({ sites, adminPassword, onAdd, onEdit, onDelete, onClose }: AdminPanelProps) {
  const [editing, setEditing] = useState<SiteData | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_FORM())
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')

  void adminPassword

  const openEdit = (s: SiteData) => {
    setEditing(s); setAdding(false); setApiError('')
    setForm({ name: s.name, subtitle: s.subtitle, links: s.links.map(l => ({ ...l })), isPrivate: s.isPrivate, subsystemId: s.subsystemId })
  }
  const openAdd = () => {
    setAdding(true); setEditing(null); setApiError('')
    setForm(BLANK_FORM())
  }
  const closeForm = () => { setEditing(null); setAdding(false); setApiError('') }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await onDelete(id)
      setConfirmDelete(null)
      if (editing?.id === id) closeForm()
    } catch {
      setApiError('刪除失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const links = form.links.filter(l => l.url.trim())
    if (!form.name.trim() || links.length === 0) return
    setBusy(true)
    setApiError('')
    try {
      const subsystemId = form.subsystemId?.trim() || null
      if (adding) {
        // worldXZ used to place a landmark in the (now removed) 3D city view
        // — no visual meaning left, but portal_sites still has the column,
        // so a constant placeholder satisfies the schema without carrying
        // over the old position-pool logic.
        await onAdd({ name: form.name.trim(), subtitle: form.subtitle.trim(), links, worldXZ: [0, 0], isPrivate: form.isPrivate, subsystemId })
      } else if (editing) {
        await onEdit(editing.id, { name: form.name.trim(), subtitle: form.subtitle.trim(), links, isPrivate: form.isPrivate, subsystemId })
      }
      closeForm()
    } catch {
      setApiError('儲存失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const setLink = (idx: number, field: keyof SiteLink, val: string) =>
    setForm(f => { const links = f.links.map((l, i) => i === idx ? { ...l, [field]: val } : l); return { ...f, links } })

  const addLink = () => setForm(f => ({ ...f, links: [...f.links, { label: '', url: '' }] }))
  const removeLink = (idx: number) => setForm(f => ({ ...f, links: f.links.filter((_, i) => i !== idx) }))

  const showForm = adding || editing !== null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.9)' }}>
      <div style={{ width: '680px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '1.8rem 2rem', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.6rem' }}>
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>網站管理</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.78rem', fontFamily: FONT.body }}>關閉</button>
        </div>

        {apiError && (
          <div style={{ marginBottom: '14px', padding: '0.6rem 0.8rem', background: 'rgba(226,88,79,0.1)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', fontSize: '0.72rem', color: COLOR.crit }}>{apiError}</div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '0.68rem', color: COLOR.steel, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.ok, display: 'inline-block' }} /> 公領域
          </div>
          <div style={{ fontSize: '0.68rem', color: COLOR.amberDim, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.amber, display: 'inline-block' }} /> 私領域
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {sites.map(s => (
            <div key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '0.7rem 1rem',
                background: editing?.id === s.id ? COLOR.panelRaised2 : COLOR.panelRaised,
                border: `1px solid ${editing?.id === s.id ? COLOR.lineBright : COLOR.line}`,
                borderRadius: confirmDelete === s.id ? '5px 5px 0 0' : '5px',
              }}>
                <span style={{
                  fontSize: '0.62rem', padding: '2px 7px', borderRadius: '3px', whiteSpace: 'nowrap',
                  background: s.isPrivate ? 'rgba(245,166,35,0.12)' : 'rgba(95,191,122,0.12)',
                  color: s.isPrivate ? COLOR.amber : COLOR.ok,
                  border: `1px solid ${s.isPrivate ? COLOR.amberDim : COLOR.ok}`,
                }}>{s.isPrivate ? '私' : '公'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, color: COLOR.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.links[0]?.url}</div>
                </div>
                <button onClick={() => openEdit(s)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(154,164,182,0.08)', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>編輯</button>
                <button onClick={() => setConfirmDelete(confirmDelete === s.id ? null : s.id)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(226,88,79,0.08)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>刪除</button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 1rem', background: 'rgba(226,88,79,0.06)', border: `1px solid ${COLOR.crit}`, borderTop: 'none', borderRadius: '0 0 5px 5px' }}>
                  <span style={{ flex: 1, fontSize: '0.72rem', color: COLOR.crit }}>確定刪除「{s.name}」？</span>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
                  <button onClick={() => { void handleDelete(s.id) }} disabled={busy} style={{ padding: '0.3rem 0.7rem', background: 'rgba(226,88,79,0.16)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}>確定刪除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showForm && (
          <button onClick={openAdd} disabled={busy} style={{ width: '100%', padding: '0.65rem', background: 'rgba(95,191,122,0.06)', border: `1px dashed ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body, letterSpacing: '0.06em' }}>＋ 新增網站</button>
        )}

        {showForm && (
          <div style={{ marginTop: '12px', padding: '1.3rem 1.4rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink, marginBottom: '1.1rem' }}>{adding ? '新增網站' : '編輯網站'}</div>

            <FormField label="名稱"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="系統名稱" style={inputSt} /></FormField>
            <FormField label="副標題（選填）"><input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="English subtitle" style={inputSt} /></FormField>

            <FormField label="領域設定">
              <div style={{ display: 'flex', gap: '8px' }}>
                {([false, true] as const).map(priv => (
                  <button key={String(priv)} onClick={() => setForm(f => ({ ...f, isPrivate: priv }))}
                    style={{
                      padding: '0.4rem 1rem',
                      background: form.isPrivate === priv ? (priv ? 'rgba(245,166,35,0.14)' : 'rgba(95,191,122,0.12)') : COLOR.panelDeep,
                      border: `1px solid ${form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.line}`,
                      borderRadius: '4px',
                      color: form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.steelDim,
                      fontSize: '0.72rem', cursor: 'pointer', fontFamily: FONT.body,
                    }}>
                    {priv ? '🔒 私領域' : '🌐 公領域'}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="儀表板摘要來源 ID（選填）">
              <input value={form.subsystemId ?? ''} onChange={e => setForm(f => ({ ...f, subsystemId: e.target.value }))} placeholder="例如 pf-cwh，留空則顯示為一般連結卡" style={inputSt} />
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '8px' }}>連結</div>
              {form.links.map((link, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input value={link.label} onChange={e => setLink(idx, 'label', e.target.value)} placeholder="按鈕文字" style={{ ...inputSt, width: '100px', flex: '0 0 100px' }} />
                  <input value={link.url} onChange={e => setLink(idx, 'url', e.target.value)} placeholder="https://..." style={{ ...inputSt, flex: 1 }} />
                  {form.links.length > 1 && (
                    <button onClick={() => removeLink(idx)} style={{ background: 'none', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, padding: '0 10px', cursor: 'pointer', fontSize: '1rem', fontFamily: FONT.body, flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {form.links.length < 3 && (
                <button onClick={addLink} style={{ fontSize: '0.68rem', color: COLOR.steel, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: FONT.body, letterSpacing: '0.04em' }}>＋ 新增連結</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={closeForm} disabled={busy} style={{ flex: 1, padding: '0.6rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
              <button onClick={() => { void handleSave() }} disabled={busy} style={{ flex: 2, padding: '0.6rem', background: 'rgba(95,191,122,0.1)', border: `1px solid ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: busy ? 0.6 : 1 }}>{busy ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdminAuthModal({ onSuccess, onCancel }: { onSuccess: (pw: string) => void; onCancel: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      onSuccess(input)
    } else {
      setError('通行碼錯誤')
      setInput('')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2rem 2.2rem', width: '320px', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px' }}>輸入通行碼</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input type="password" value={input} autoFocus placeholder="••••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{ width: '100%', padding: '0.6rem 0.8rem', background: COLOR.panelDeep, border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink, fontSize: '0.85rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em' }} />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.55rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.75rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.55rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>{loading ? '驗證中…' : '進入'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VersionHistory() {
  const [expanded, setExpanded] = useState(false)
  const latest = VERSION_HISTORY[0]!
  return (
    <div style={{ position: 'absolute', bottom: '1.5rem', left: '1.5rem', zIndex: 100, fontFamily: FONT.body, maxWidth: 'calc(50vw - 2rem)' }}>
      <button onClick={() => setExpanded(x => !x)} style={{
        display: 'flex', alignItems: 'center', gap: '6px', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.5rem 0.8rem', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.steel, whiteSpace: 'nowrap',
      }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>v{latest.version}</span>
        <span style={{ color: COLOR.steelDim, fontSize: '0.6rem' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: '8px', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '6px', padding: '1.1rem 1.2rem', width: 'min(300px, calc(100vw - 3rem))', maxHeight: '60vh', overflowY: 'auto' }}>
          {VERSION_HISTORY.map((v, vi) => (
            <div key={v.version} style={{ marginBottom: vi < VERSION_HISTORY.length - 1 ? '18px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: FONT.mono, fontSize: '0.72rem', fontWeight: 600, color: COLOR.amber }}>v{v.version}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim }}>{v.date}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: COLOR.steel, lineHeight: 1.6, marginBottom: '7px' }}>{v.summary}</div>
              <ul style={{ margin: 0, padding: '0 0 0 14px' }}>
                {v.changes.map((c, ci) => <li key={ci} style={{ fontSize: '0.68rem', color: COLOR.steelDim, lineHeight: 1.7 }}>{c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Instrument Panel View — top-level layout
// ─────────────────────────────────────────────
function InstrumentPanelView({
  sites,
  dashboard,
  unlocked,
  unlockedPassword,
  onSiteSelect,
  onRequestUnlock,
}: {
  sites: SiteData[]
  dashboard: DashboardSummary[]
  unlocked: boolean
  unlockedPassword: string | null
  onSiteSelect: (site: SiteData) => void
  onRequestUnlock: () => void
}) {
  const publicSites = sites.filter(s => !s.isPrivate)
  const privateSites = sites.filter(s => s.isPrivate)

  const richSites: SiteData[] = []
  const plainSites: SiteData[] = []
  privateSites.forEach(s => {
    const summary = s.subsystemId ? dashboard.find(d => d.subsystemId === s.subsystemId) : undefined
    if (summary && SUMMARY_BODIES[summary.subsystemId]) richSites.push(s)
    else plainSites.push(s)
  })
  const HHI_SITE_PRIORITY: Record<string, number> = { 'pf-cwh': 0, fitnessforge: 1, vikunja: 2, travel: 3 }
  richSites.sort((a, b) => (HHI_SITE_PRIORITY[a.subsystemId ?? ''] ?? 99) - (HHI_SITE_PRIORITY[b.subsystemId ?? ''] ?? 99))
  const hhiSummary = dashboard.find(d => d.subsystemId === 'hhi')

  const [hermesOpen, setHermesOpen] = useState(false)

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: COLOR.panelDeep }}>
      <div style={{
        position: 'relative', flexShrink: 0, padding: '1.4rem 2rem 1.1rem', borderBottom: `2px solid ${COLOR.line}`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', margin: 0, lineHeight: 1, color: COLOR.ink, animation: 'header-flicker 12s infinite' }}>
            翰翰儀表板
          </h1>
          <span style={{ fontFamily: FONT.latin, fontSize: '0.62rem', letterSpacing: '0.2em', color: COLOR.amber, textTransform: 'uppercase', marginTop: '0.3rem', display: 'block' }}>
            Life Instrumentation · 即時遙測面板
          </span>
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, textAlign: 'right', lineHeight: 1.6 }}>
          {sites.length > 0 ? `${sites.length} PORTALS AVAILABLE` : 'CONNECTING...'}
        </div>
      </div>

      <div className="ip-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.4rem 1.6rem 5rem' }}>
        <Unit code="01" title="翰翰仔幸福指數 · Hanhan Happiness Index">
          <HappinessHeroCard
            summary={hhiSummary}
            unlocked={unlocked}
            unlockedPassword={unlockedPassword}
            onRequestUnlock={onRequestUnlock}
          />
        </Unit>

        <Unit code="02" title="六維度子系統 · Subsystem Readouts">
          <div className="ip-dim-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {richSites.map(s => {
              const summary = dashboard.find(d => d.subsystemId === s.subsystemId)!
              return <DimensionGauge key={s.id} site={s} summary={summary} hhiSummary={hhiSummary} unlocked={unlocked} onSelect={onSiteSelect} />
            })}
            <MindIndexCard
              summary={dashboard.find(d => d.subsystemId === 'mind-index')}
              hhiSummary={hhiSummary}
              unlocked={unlocked}
              onSelect={onRequestUnlock}
            />
            <SocialIndexCard
              summary={dashboard.find(d => d.subsystemId === 'social-index')}
              hhiSummary={hhiSummary}
              unlocked={unlocked}
              onSelect={onRequestUnlock}
            />
          </div>
        </Unit>

        <div
          onClick={() => setHermesOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: hermesOpen ? '0' : '1.1rem' }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: COLOR.steelDim, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
            <span style={{ color: COLOR.amberDim }}>03</span>
            <span style={{ fontFamily: FONT.body, fontSize: '0.72rem', letterSpacing: '0.08em', color: COLOR.steel, textTransform: 'none' }}>
              HERMES 戰情室 · Ops Telemetry{!unlocked ? '（🔒）' : ''}
            </span>
            <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: hermesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <span style={{ flex: 1, height: '1px', background: COLOR.line }} />
          </span>
        </div>
        {hermesOpen && (
          <Unit code="03" title="HERMES 戰情室 · Ops Telemetry">
            <HermesWarRoomSection
              unlocked={unlocked}
              unlockedPassword={unlockedPassword}
              onRequestUnlock={onRequestUnlock}
              mindSummary={dashboard.find(d => d.subsystemId === 'mind-index')}
            />
          </Unit>
        )}

        <ToolLinksZone privateSites={plainSites} publicSites={publicSites} unlocked={unlocked} onSelect={onSiteSelect} />

        <div style={{ marginTop: '1.4rem', paddingTop: '1rem', borderTop: `1px solid ${COLOR.line}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, letterSpacing: '0.06em' }}>
          <span>AIPORTAL · INSTRUMENT PANEL</span>
          <span>🔐 PRIVATE REQUIRES PASSWORD</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const [sites, setSites] = useState<SiteData[]>([])
  const [dashboard, setDashboard] = useState<DashboardSummary[]>([])
  const [unlockedPassword, setUnlockedPassword] = useState<string | null>(() => localStorage.getItem(UNLOCK_KEY))
  const unlocked = !!unlockedPassword
  const [modal, setModal] = useState<{ visible: boolean; pendingUrl: string }>({ visible: false, pendingUrl: '' })
  const [adminAuth, setAdminAuth] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')

  const refreshSites = useCallback(async () => {
    try {
      const data = await apiFetchSites()
      setSites(data)
    } catch {
      // silently keep whatever we have
    }
  }, [])

  useEffect(() => {
    apiFetchSites()
      .then(data => { setSites(data) })
      .catch(() => { /* keep empty sites on error */ })
  }, [])

  useEffect(() => {
    apiFetchDashboard(unlockedPassword)
      .then(({ summaries, unlocked }) => {
        setDashboard(summaries)
        if (unlockedPassword && !unlocked) {
          localStorage.removeItem(UNLOCK_KEY)
          setUnlockedPassword(null)
        }
      })
      .catch(() => { /* keep whatever we have */ })
  }, [unlockedPassword])

  const openUrl = useCallback((url: string, isPrivate: boolean) => {
    if (!isPrivate || unlocked) {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      setModal({ visible: true, pendingUrl: url })
    }
  }, [unlocked])

  const handleSiteClick = useCallback((site: SiteData) => {
    openUrl(site.links[0]?.url ?? '', site.isPrivate)
  }, [openUrl])

  const handleRequestUnlock = useCallback(() => {
    setModal({ visible: true, pendingUrl: '' })
  }, [])

  const handleModalSuccess = useCallback((password: string) => {
    setUnlockedPassword(password)
    setModal({ visible: false, pendingUrl: '' })
  }, [])

  const handleAdminAuthSuccess = useCallback((pw: string) => {
    setAdminPassword(pw)
    setAdminAuth(false)
    setAdminOpen(true)
  }, [])

  const handleAdd = useCallback(async (data: Omit<SiteData, 'id'>) => {
    await apiAddSite(data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleEdit = useCallback(async (id: string, data: Partial<Omit<SiteData, 'id'>>) => {
    await apiUpdateSite(id, data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleDelete = useCallback(async (id: string) => {
    await apiDeleteSite(id, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLOR.panelDeep, position: 'relative', overflow: 'hidden' }}>
      <InstrumentPanelView
        sites={sites}
        dashboard={dashboard}
        unlocked={unlocked}
        unlockedPassword={unlockedPassword}
        onSiteSelect={handleSiteClick}
        onRequestUnlock={handleRequestUnlock}
      />

      <VersionHistory />

      <button
        onClick={() => setAdminAuth(true)}
        title="管理後台"
        style={{
          position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
          background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
          color: COLOR.steelDim, fontSize: '1rem', padding: '0.5rem 0.8rem', cursor: 'pointer', lineHeight: 1,
        }}
      >⚙</button>

      {modal.visible && (
        <PasswordModal
          pendingUrl={modal.pendingUrl}
          onSuccess={handleModalSuccess}
          onCancel={() => setModal({ visible: false, pendingUrl: '' })}
        />
      )}

      {adminAuth && !adminOpen && (
        <AdminAuthModal onSuccess={handleAdminAuthSuccess} onCancel={() => setAdminAuth(false)} />
      )}

      {adminOpen && (
        <AdminPanel
          sites={sites}
          adminPassword={adminPassword}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  )
}
