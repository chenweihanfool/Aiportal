// 登入相關的純函式（不碰 React／DOM／網路）。

export const GOOGLE_SESSION_SENTINEL = 'google-session'

export type AuthStatus =
  | { kind: 'loading' }
  | { kind: 'in'; email: string }                                   // 已用 Google 登入
  | { kind: 'login-required'; configured: boolean }                 // 伺服器強制登入且尚未登入
  | { kind: 'optional' }                                            // 沒有強制登入：維持原本（密碼解鎖）行為

/** /api/auth/me 的回應 → 狀態。網路錯誤或舊版伺服器（沒有這支）一律視為 optional，不擋住網站。 */
export function interpretMe(status: number, body: unknown): AuthStatus {
  const b = (typeof body === 'object' && body !== null ? body : {}) as { email?: unknown; loginRequired?: unknown; configured?: unknown }
  if (status === 200 && typeof b.email === 'string') return { kind: 'in', email: b.email }
  if (status === 401 && b.loginRequired === true) return { kind: 'login-required', configured: b.configured !== false }
  return { kind: 'optional' }
}

const LOGIN_ERRORS: Record<string, string> = {
  denied: '這個 Google 帳號不在白名單內。這是個人使用的網站，如需存取請聯絡管理者。',
  unverified: '這個 Google 帳號的 email 尚未驗證。',
  invalid_state: '登入流程逾時或已失效，請重新登入。',
  auth_failed: 'Google 登入失敗，請稍後再試。',
}

export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.auth_failed
}
