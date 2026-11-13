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

// 2.89.0 換成「青綠科技風」：鍵名沿用舊的（amber＝主色、steel＝次要文字…），值是新色票的深色版。
// COLOR 保留 hex，給 canvas、SVG 屬性與計算用；React 的 inline style 請用 CV（var(--c-…)），深淺切換才會跟著變。
export const COLOR = {
  panelDeep: '#080b0e',
  panel: '#0e1317',
  panelRaised: '#141b20',
  panelRaised2: '#1b252b',
  line: '#1e2a30',
  lineBright: '#2b3a42',

  amber: '#3de0c2',
  amberDim: '#1f8f7b',

  steel: '#8a9aa0',
  steelDim: '#7a898f',

  ink: '#e6eef0',
  inkDim: '#8a9aa0',

  // Semantic tones — kept separate from the accent so a status color
  // never gets mistaken for "this is the highlighted/primary thing".
  ok: '#4fd18b',
  warn: '#f0b454',
  concern: '#e8894a',
  crit: '#ff7a6b',
} as const

/** 給 React inline style 用：與 COLOR 同鍵，值是 var(--c-…)，隨深／淺主題變。 */
export const CV = {
  panelDeep: 'var(--c-bg)',
  panel: 'var(--c-surface)',
  panelRaised: 'var(--c-raised)',
  panelRaised2: 'var(--c-raised-2)',
  line: 'var(--c-line)',
  lineBright: 'var(--c-line-strong)',

  amber: 'var(--c-accent)',
  amberDim: 'var(--c-accent-dim)',

  steel: 'var(--c-ink-2)',
  steelDim: 'var(--c-ink-3)',

  ink: 'var(--c-ink)',
  inkDim: 'var(--c-ink-2)',

  ok: 'var(--c-ok)',
  warn: 'var(--c-warn)',
  concern: 'var(--c-concern)',
  crit: 'var(--c-crit)',
} as const

// 分數色階（低→高，越綠越好；中間亮度，深淺底色上都看得到，所以不隨主題變）：熱圖、時間軸徽章、六面向分數共用同一組顏色。
// 門檻見 SCORE_THRESHOLDS；高分成長軌跡是綠、低分是紅，琥珀不再是最高分。
export const SCORE_SCALE = {
  crit: '#e2584f',
  concern: '#d9772e',
  warn: '#e8b23d',
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
  '--c-hover': '#19232a',
  '--c-raised-2': COLOR.panelRaised2,
  '--c-line': COLOR.line,
  '--c-line-strong': COLOR.lineBright,
  '--c-ink': COLOR.ink,
  '--c-ink-2': COLOR.steel,
  '--c-ink-3': COLOR.steelDim,
  '--c-accent': COLOR.amber,
  '--c-accent-dim': COLOR.amberDim,
  '--c-accent-soft': 'rgba(61, 224, 194, 0.1)',
  '--c-accent-ink': '#8ff3df',
  '--c-ok': COLOR.ok,
  '--c-warn': COLOR.warn,
  '--c-warn-soft': 'rgba(240, 180, 84, 0.1)',
  '--c-concern': COLOR.concern,
  '--c-crit': COLOR.crit,
  '--c-grid': 'rgba(120, 170, 180, 0.055)',
  // 半透明疊層（卡片 hover、分隔格）：深色加亮、淺色加暗
  '--c-wash': 'rgba(255, 255, 255, 0.04)',
  // 分數色階的高分兩級（低分沿用 warn／concern／crit）
  '--c-score-crit': SCORE_SCALE.crit,
  '--c-score-concern': SCORE_SCALE.concern,
  '--c-score-warn': SCORE_SCALE.warn,
  '--c-score-good': SCORE_SCALE.good,
  '--c-score-great': SCORE_SCALE.great,
  // 知識星空樹的枝條漸層（由下往上：天藍 → 薄荷）
  '--c-sky': '#4b8df7',
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

// 淺色版（:root[data-theme="light"]，以及「跟系統」且系統為淺色時）：只列與深色不同的 token。
// 文字色對 --c-bg／--c-surface 都 ≥ 4.5:1（themeContrast.test.ts 驗）。portal.css 兩處淺色區塊必須與這張表同名同值。
export const CSS_TOKENS_LIGHT: Record<string, string> = {
  '--c-bg': '#f4f7f8',
  '--c-surface': '#ffffff',
  '--c-raised': '#f0f4f5',
  '--c-hover': '#e6edef',
  '--c-raised-2': '#e8eef0',
  '--c-line': '#dde5e8',
  '--c-line-strong': '#c6d2d7',
  '--c-ink': '#101a1e',
  '--c-ink-2': '#52636a',
  '--c-ink-3': '#5f6f76',
  '--c-accent': '#087562',
  '--c-accent-dim': '#0a7a66',
  '--c-accent-soft': 'rgba(8, 117, 98, 0.09)',
  '--c-accent-ink': '#065446',
  '--c-ok': '#1b7f45',
  '--c-warn': '#8f5608',
  '--c-warn-soft': 'rgba(143, 86, 8, 0.09)',
  '--c-concern': '#a8480a',
  '--c-crit': '#b83a30',
  '--c-grid': 'rgba(20, 60, 70, 0.05)',
  '--c-wash': 'rgba(16, 26, 30, 0.045)',
  '--c-score-crit': '#b83a30',
  '--c-score-concern': '#a8480a',
  '--c-score-warn': '#8f5608',
  '--c-score-good': '#587a12',
  '--c-score-great': '#1b7f45',
  '--c-sky': '#2563eb',
  '--c-mint': '#0f9f8a',
}

/** 把任何顏色（hex 或 var(--c-…)）調成指定百分比的半透明：取代以前的 `${hex}33` 拼接，深淺主題都能用。 */
export const alpha = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`

const SCORE_VAR: Record<string, string> = {
  [SCORE_SCALE.crit]: 'var(--c-score-crit)',
  [SCORE_SCALE.concern]: 'var(--c-score-concern)',
  [SCORE_SCALE.warn]: 'var(--c-score-warn)',
  [SCORE_SCALE.good]: 'var(--c-score-good)',
  [SCORE_SCALE.great]: 'var(--c-score-great)',
}
/** SCORE_SCALE 的 5 個 hex → var(--c-score-…)（淺色主題會換成較深的值）；其他值原樣回傳。給 scoreColor／tone.color 當文字色或細線色時用。 */
export const scoreVar = (hex: string): string => SCORE_VAR[hex.toLowerCase()] ?? hex

const COLOR_VAR: Record<string, string> = Object.fromEntries(
  (Object.keys(COLOR) as (keyof typeof COLOR)[]).filter((k) => !(COLOR[k] in SCORE_VAR)).map((k) => [COLOR[k], CV[k]]),
)
/** 分數色或 COLOR 的 hex → 對應的 CSS 變數（深淺主題都對）；其他值原樣回傳。給「拿到 hex 才上色」的地方用。 */
export const themedColor = (hex: string): string => SCORE_VAR[hex.toLowerCase()] ?? COLOR_VAR[hex.toLowerCase()] ?? hex
