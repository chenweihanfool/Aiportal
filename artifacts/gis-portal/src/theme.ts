// ─────────────────────────────────────────────
// Shared visual theme — single place for colors/fonts that used to be
// copy-pasted as literals across App.tsx. Semantic meaning is unchanged
// (cyan = public zone / 3D mode, purple = private zone / arcade mode);
// this just gives every card/chart one source to read from so a palette
// tweak doesn't require hunting through ~2700 lines of inline styles.
// ─────────────────────────────────────────────

export const FONT_STACK = '"Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif'

export const COLOR = {
  bg: '#050814',
  cyan: '#00e5ff',
  cyanRgb: '0,229,255',
  purple: '#c084fc',
  purpleRgb: '192,132,252',
  green: '#34d399',
  amber: '#fbbf24',
  orange: '#fb923c',
  red: '#f87171',
  gold: '#d4a900',
} as const

// Hue degrees (0-360) for the same accent colors above, used by the glass
// card shell's silk-band / comet-border layers (portal.css), which are
// driven by a single `--card-hue` custom property fed into `hsla(var(--card-hue), ...)`
// rather than a fixed hex — letting one CSS rule serve every card color.
export const CARD_HUE = {
  cyan: 186,
  purple: 270,
  green: 158,
  amber: 43,
  red: 0,
} as const
