// ─────────────────────────────────────────────
// Shared visual theme — instrument-panel identity (2026-08-31 redesign).
// Single place for colors/fonts so a palette tweak doesn't require hunting
// through App.tsx. Chinese labels dominate this app's content, so the
// display/body face stays a CJK-capable font (Noto Sans TC) — the
// "instrument" character instead comes from IBM Plex Mono carrying every
// number/data readout, plus Big Shoulders Display reserved for short
// Latin-only eyebrow tags (module codes, unit numbers) where CJK coverage
// isn't needed.
// ─────────────────────────────────────────────

export const FONT = {
  display: '"Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  latin: '"Big Shoulders Display", "Arial Narrow", sans-serif',
  body: '"Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
} as const

export const COLOR = {
  panelDeep: '#121319',
  panel: '#1a1c22',
  panelRaised: '#24262e',
  panelRaised2: '#2c2f39',
  line: '#3a3d47',
  lineBright: '#565a68',

  amber: '#f5a623',
  amberDim: '#8a5f18',

  steel: '#9aa4b6',
  steelDim: '#5b6270',

  ink: '#ece9e2',
  inkDim: '#8f8f88',

  // Semantic tones — kept separate from the amber accent so a status color
  // never gets mistaken for "this is the highlighted/primary thing".
  ok: '#5fbf7a',
  warn: '#e8b23d',
  concern: '#d9772e',
  crit: '#e2584f',
} as const

// 分數色階（低→高，越綠越好）：熱圖、時間軸徽章、六面向分數共用同一組顏色。
// 門檻見 SCORE_THRESHOLDS；高分成長軌跡是綠、低分是紅，琥珀不再是最高分。
export const SCORE_SCALE = {
  crit: COLOR.crit,
  concern: COLOR.concern,
  warn: COLOR.warn,
  good: '#9cc44a',   // 黃綠：65–79
  great: '#34c26b',  // 綠：80 以上
} as const

/** 分數色階的門檻（低→高）：≥35 concern、≥50 warn、≥65 good、≥80 great，以下 crit。 */
export const SCORE_THRESHOLDS = [35, 50, 65, 80] as const

// ─────────────────────────────────────────────
// 設計 token（2.53.0 首頁改版）：portal.css 的 :root 用同一組名稱與值定義 CSS 變數（--c-* 顏色、--sp-* 間距、--r-* 圓角、--fs-* 字級），
// 樣式表一律寫 var(--…)，不再散寫色碼；JS 的行內樣式仍用上面的 COLOR／FONT。
// 兩邊必須一致——theme.test.ts 會讀 portal.css 的 :root 比對這張表，不一致就紅。改色先改這裡，再改 portal.css。
// ─────────────────────────────────────────────
export const CSS_TOKENS: Record<string, string> = {
  // 顏色：底 → 卡片 → 卡片內小格（越上層越亮）
  '--c-bg': COLOR.panelDeep,
  '--c-surface': COLOR.panel,
  '--c-raised': COLOR.panelRaised,
  '--c-hover': '#2a2d36',
  '--c-raised-2': COLOR.panelRaised2,
  '--c-line': COLOR.line,
  '--c-line-strong': COLOR.lineBright,
  '--c-ink': COLOR.ink,
  '--c-ink-2': COLOR.steel,
  '--c-ink-3': COLOR.steelDim,
  '--c-accent': COLOR.amber,
  '--c-accent-dim': COLOR.amberDim,
  '--c-ok': COLOR.ok,
  '--c-warn': COLOR.warn,
  '--c-concern': COLOR.concern,
  '--c-crit': COLOR.crit,
  // 分數色階的高分兩級（低分沿用 warn／concern／crit）
  '--c-score-good': SCORE_SCALE.good,
  '--c-score-great': SCORE_SCALE.great,
  // 知識星空樹的枝條漸層（由下往上：天藍 → 薄荷）
  '--c-sky': '#3b82f6',
  '--c-mint': '#5eead4',
  // 間距：4px 為一階
  '--sp-1': '0.25rem',
  '--sp-2': '0.5rem',
  '--sp-3': '0.75rem',
  '--sp-4': '1rem',
  '--sp-5': '1.25rem',
  '--sp-6': '1.5rem',
  // 圓角：小格／按鈕、卡片內小卡、區塊卡片、膠囊
  '--r-sm': '6px',
  '--r-md': '8px',
  '--r-lg': '12px',
  '--r-pill': '999px',
  // 字級
  '--fs-2xs': '0.62rem',
  '--fs-xs': '0.7rem',
  '--fs-sm': '0.78rem',
  '--fs-md': '0.88rem',
  '--fs-lg': '1rem',
  // 頂欄高度（桌機）；手機頁首隨內容
  '--topbar-h': '3.25rem',
}
