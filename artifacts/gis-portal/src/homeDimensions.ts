// 新首頁（HomeBoard）六個面向的名稱與識別色，集中在這一個檔。
// 使用者尚未裁定新名稱與識別色（審計報告 §2.3、§2.5【需決定】）：
//   - 名稱先沿用現有的（buildHhiBreakdown／幸福指數表格同一組），之後改名只改這裡。
//   - 識別色是 §2.5 的「財務＝金、身體＝青綠、從容＝藍、心智＝紫、社交＝珊瑚、旅遊與美食＝橘」提案，
//     與狀態色（ok／warn／crit）分開，只用來讓人用顏色認出面向，不代表好壞。
// key 必須與 boardView.ts 的 buildHhiBreakdown 一致。

export interface HomeDimension {
  key: string
  /** 顯示名稱（沿用現有名稱，待使用者裁定） */
  label: string
  icon: string
  /** 識別色（提案值，待使用者裁定） */
  color: string
}

export const HOME_DIMENSIONS: HomeDimension[] = [
  { key: 'lifeFreedom', label: '人生自由', icon: '💰', color: '#d9b44a' },
  { key: 'fitness', label: '健身習慣', icon: '🏃', color: '#3fb6a8' },
  { key: 'calm', label: '生活從容', icon: '🌿', color: '#5f9bf0' },
  { key: 'mind', label: '心智指標', icon: '🧠', color: '#9b8cf0' },
  { key: 'social', label: '社交指標', icon: '👥', color: '#ee7a6e' },
  { key: 'travel', label: '旅遊生活', icon: '🧳', color: '#f29e4c' },
]

const BY_KEY = new Map(HOME_DIMENSIONS.map((d) => [d.key, d]))

/** 依 key 取面向設定；未知 key（後端日後新增面向）回 null，由呼叫端用 row.label 與中性色退回 */
export const dimensionOf = (key: string): HomeDimension | null => BY_KEY.get(key) ?? null

/** 中性識別色（未知面向用） */
export const DIMENSION_FALLBACK_COLOR = '#9aa4b6'
