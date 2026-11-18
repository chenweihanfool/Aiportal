// 心得樹的裝飾幾何（純函式，3.10.0）：樹幹根基外擴、土壤帶。只算形狀，不影響排版與點擊。

const r1 = (n: number): number => Math.round(n * 10) / 10

/** 根基外擴：樹幹底部向兩側微張，像長在地上。trunkW 是樹幹底部寬（InsightLimb.width），回傳封閉路徑 */
export function rootFlarePath(cx: number, ground: number, trunkW: number): string {
  const hw = Math.max(1, trunkW) / 2
  const f = Math.max(4, trunkW * 0.5)
  const h = Math.max(4, trunkW * 0.6)
  const y0 = ground + 1.5
  return [
    `M${r1(cx - hw - f)},${r1(y0)}`,
    `C${r1(cx - hw - f * 0.35)},${r1(y0 - 0.5)} ${r1(cx - hw - 0.5)},${r1(ground - h * 0.25)} ${r1(cx - hw + 0.8)},${r1(ground - h)}`,
    `L${r1(cx + hw - 0.8)},${r1(ground - h)}`,
    `C${r1(cx + hw + 0.5)},${r1(ground - h * 0.25)} ${r1(cx + hw + f * 0.35)},${r1(y0 - 0.5)} ${r1(cx + hw + f)},${r1(y0)}`,
    'Z',
  ].join(' ')
}

/** 地平線下的土壤帶：寬度內縮 6，高度不超過畫布下緣與 maxH */
export function soilBand(width: number, ground: number, bottom: number, maxH = 16): { x: number; y: number; w: number; h: number } {
  const y = ground + 1.4
  return { x: 6, y: r1(y), w: Math.max(0, r1(width - 12)), h: Math.max(0, r1(Math.min(maxH, bottom - y))) }
}
