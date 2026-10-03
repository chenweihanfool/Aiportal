// 關係宇宙總覽的視覺參數與純函式（從 RelationshipUniverse.tsx 抽出，才能單元測試；畫布本身沒有 DOM 測試）。

// 沒有選取／hover 時，邊要畫得多淡：連線數一多（正式資料約 3 千條），每條 0.3 的直線疊起來就是一團白色毛球，
// 看不出任何結構，也沒有「宇宙」的樣子。所以預設把每條邊壓到很淡——稀疏處幾乎看不見、多條邊集中的走廊自然變亮，
// 結構由疊加的濃度而不是線條本身表現。連線很少（小圖）時維持原本 0.3 的可讀濃度。
// （試過 'lighter' 加色混合：樣子更像星雲，但在沒有 GPU 的環境幀時間會變成兩倍以上，而且連到超級樞紐的邊會燒成死白，所以用一般混合。）
export const IDLE_EDGE_ALPHA_MAX = 0.3
export const IDLE_EDGE_ALPHA_BUDGET = 220
export const idleEdgeAlpha = (linkCount: number) => Math.min(IDLE_EDGE_ALPHA_MAX, IDLE_EDGE_ALPHA_BUDGET / Math.max(1, linkCount))

/** 連到超級樞紐的邊再壓淡：幾百條邊收斂到同一點，疊起來會蓋成一團實心。度數 ≤64 不壓，其後依 1/√度數遞減。 */
export const hubDamp = (maxDegree: number) => Math.min(1, 8 / Math.sqrt(Math.max(1, maxDegree)))

// 總覽有幾千條邊，逐條 beginPath／stroke 太慢（實測幀時間是舊版的兩倍以上）：把透明度量化成 EDGE_LEVELS 級，
// 同一級的線段合併成一條路徑、一次 stroke。
export const EDGE_LEVELS = 8
/** 0 表示不畫（太淡）；1..EDGE_LEVELS 是量化後的級數，實際透明度＝級數 × (idleAlpha / EDGE_LEVELS)。 */
export function edgeLevel(endpointOpacity: number, idleAlpha: number, damp: number): number {
  const step = idleAlpha / EDGE_LEVELS
  if (!(step > 0)) return 0
  return Math.min(EDGE_LEVELS, Math.max(0, Math.ceil((endpointOpacity * idleAlpha * damp) / step)))
}

// 近端節點的視覺放大上限（相對於世界原點處的投影比例）。透視會讓貼近鏡頭的節點膨脹成幾十 px 的大圓盤，
// 糊在畫面邊緣像是髒點；超過上限的部分不再放大，並隨之淡出（下限 0.2，不讓它完全消失）。
export const NEAR_SCALE_CAP = 2.0
export const nearFade = (scale: number, cap: number) => (scale > cap ? Math.max(0.2, cap / scale) : 1)
