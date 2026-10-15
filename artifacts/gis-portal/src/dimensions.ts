// 六個面向的唯一登記處（指標註冊表）：名稱、圖示、識別色、資料欄位、權重預設、來源子系統、說明文字都只寫在這裡。
// 以前這些散在六個檔（homeDimensions／boardView／HappinessHero／DimensionCards／DimensionDetail／dimensionPage），
// 改一個名稱或加一個面向要改六處；現在改這一處，其他檔都由它推導。
//
// 名稱與識別色由使用者 2026-10-15 裁定（審計報告 §2.3、§2.5、§4.15）：
//   財務自由（舊：人生自由）・身體（健身習慣）・從容（生活從容）・心智（心智指標）・社交（社交指標）・旅遊（旅遊生活）。
//   識別色是「財務＝金、身體＝青綠、從容＝藍、心智＝紫、社交＝珊瑚、旅遊與美食＝橘」，
//   與狀態色（ok／warn／crit）分開，只用來讓人用顏色認出面向，不代表好壞。
// 資料庫的「站台名稱」不在此列。
// scoreKey／weightKey／key 必須與後端 api-server 的 happinessIndex.ts／happinessDimensionHistory.ts 一致——
// dimensions.test.ts 會讀那兩個檔，不一致就紅。

/** 面向明細的呈現方式：subsystem＝子系統摘要（有 SUMMARY_BODIES 的四個）；mind／social＝各自的明細元件 */
export type DimensionDetailKind = 'subsystem' | 'mind' | 'social'

export interface DimensionDef {
  /** 與後端、歷史接口 components 的 key 相同 */
  key: string
  /** 顯示名稱 */
  label: string
  icon: string
  /** 識別色 */
  color: string
  /** /api/dashboard 的 hhi 摘要 data 裡，這個面向的正規化分數（對照自己近 90 天的百分位，0–100）欄位 */
  scoreKey: string
  /** hhi 摘要 data.weights 裡的權重欄位 */
  weightKey: string
  /** 權重欄位缺值時的預設（後端 HAPPINESS_CONFIG 的基準權重） */
  defaultWeight: number
  /** 來源子系統在 /api/dashboard summaries 的 id */
  subsystemId: string
  /** 子系統摘要裡的「原始分數」欄位（未正規化，只在詳細數據裡對照顯示）；沒有就 null */
  rawField: string | null
  detail: DimensionDetailKind
  /** 這個面向衡量什麼、資料從哪來（面向頁用） */
  about: { measures: string; source: string }
}

export const DIMENSIONS: DimensionDef[] = [
  {
    key: 'lifeFreedom', label: '財務自由', icon: '💰', color: '#d9b44a',
    scoreKey: 'lifeFreedomScore', weightKey: 'lifeFreedomWeight', defaultWeight: 0.27,
    subsystemId: 'pf-cwh', rawField: 'lifeFreedomIndex', detail: 'subsystem',
    about: { measures: '資產規模、投資報酬與休假配速三項的綜合——你離「可以自由安排時間」還有多遠。', source: '人生進度管理系統' },
  },
  {
    key: 'fitness', label: '身體', icon: '🏃', color: '#3fb6a8',
    scoreKey: 'fitnessHabitScore', weightKey: 'fitnessWeight', defaultWeight: 0.18,
    subsystemId: 'fitnessforge', rawField: 'habitIndex', detail: 'subsystem',
    about: { measures: '每週訓練量、肌群覆蓋、均衡度與趨勢的綜合——有沒有持續、全面地練。', source: '運動 APP（FitnessForge）' },
  },
  {
    key: 'calm', label: '從容', icon: '🌿', color: '#5f9bf0',
    // calmScore 已經反向＋正規化（越高越從容）；rawField 的 busyIndex 是「越高越忙」的原始值，只在詳細數據裡對照顯示
    scoreKey: 'calmScore', weightKey: 'calmWeight', defaultWeight: 0.15,
    subsystemId: 'vikunja', rawField: 'busyIndex', detail: 'subsystem',
    about: { measures: '任務有沒有堆積：逾期壓力、近期負荷、停滯與拖延反過來算，越高越從容。', source: '任務追蹤系統（Vikunja）' },
  },
  {
    key: 'mind', label: '心智', icon: '🧠', color: '#9b8cf0',
    scoreKey: 'mindScore', weightKey: 'mindWeight', defaultWeight: 0.15,
    subsystemId: 'mind-index', rawField: null, detail: 'mind',
    about: { measures: '想法的產生與實行（占 80%）加上最新一份日報的自我評分（占 20%）。', source: '想法庫與每日報告（HERMES）' },
  },
  {
    key: 'social', label: '社交', icon: '👥', color: '#ee7a6e',
    scoreKey: 'socialScore', weightKey: 'socialWeight', defaultWeight: 0.13,
    subsystemId: 'social-index', rawField: null, detail: 'social',
    about: { measures: '近 7 天的社交廣度、互動強度與連結率；全部從日記被動萃取，不需要另外記錄。', source: '日記（HERMES 萃取）' },
  },
  {
    key: 'travel', label: '旅遊', icon: '🧳', color: '#f29e4c',
    scoreKey: 'travelScore', weightKey: 'travelWeight', defaultWeight: 0.12,
    subsystemId: 'travel', rawField: 'travelScore', detail: 'subsystem',
    about: { measures: '距上次旅行多久、近 180 天累積的旅行天數，有排定的行程再加分。', source: '旅遊生活（AdventureLog）' },
  },
]

const BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]))
const BY_SUBSYSTEM = new Map(DIMENSIONS.map((d) => [d.subsystemId, d]))

/** 依 key 取面向設定；未知 key（後端日後新增面向）回 null，由呼叫端用 row.label 與中性色退回 */
export const dimensionOf = (key: string): DimensionDef | null => BY_KEY.get(key) ?? null

/** 依來源子系統 id（pf-cwh／fitnessforge／vikunja／travel／mind-index／social-index）取面向 */
export const dimensionBySubsystem = (id: string): DimensionDef | null => BY_SUBSYSTEM.get(id) ?? null

/** 中性識別色（未知面向用） */
export const DIMENSION_FALLBACK_COLOR = '#9aa4b6'
