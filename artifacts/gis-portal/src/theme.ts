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
