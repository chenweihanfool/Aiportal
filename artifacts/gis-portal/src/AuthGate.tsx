import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { GOOGLE_SESSION_SENTINEL, interpretMe, loginErrorMessage, type AuthStatus } from './authView'

// 整站入口：先問 /api/auth/me。
//  - 已用 Google 登入 → 放行，並把「已解鎖」狀態交給 App（沿用既有的 UNLOCK_KEY 機制，過渡期用固定哨兵值；
//    伺服器認的是 cookie，header 值不重要）。
//  - 伺服器強制登入且未登入 → 只顯示登入頁。
//  - 沒有強制登入 → 原樣顯示 App（密碼解鎖照舊），右下角多一個「Google 登入」入口。
const API_BASE = import.meta.env.BASE_URL ?? '/'
const UNLOCK_KEY = 'portal_unlocked'

async function fetchMe(): Promise<AuthStatus> {
  try {
    const r = await fetch(`${API_BASE}api/auth/me`, { credentials: 'same-origin' })
    const body: unknown = await r.json().catch(() => null)
    return interpretMe(r.status, body)
  } catch {
    return { kind: 'optional' }
  }
}

function loginUrl(): string { return `${API_BASE}api/auth/login` }

function takeLoginError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('login_error')
  if (!code) return null
  params.delete('login_error')
  const qs = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  return loginErrorMessage(code)
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'loading' })
  const [error] = useState<string | null>(takeLoginError)

  useEffect(() => {
    let cancelled = false
    void fetchMe().then(s => {
      if (cancelled) return
      try {
        if (s.kind === 'in') localStorage.setItem(UNLOCK_KEY, GOOGLE_SESSION_SENTINEL)
        else if (localStorage.getItem(UNLOCK_KEY) === GOOGLE_SESSION_SENTINEL) localStorage.removeItem(UNLOCK_KEY)
      } catch { /* localStorage 不可用：不影響登入本身 */ }
      setStatus(s)
    })
    return () => { cancelled = true }
  }, [])

  if (status.kind === 'loading') return <div style={{ minHeight: '100vh', background: COLOR.panelDeep }} />
  if (status.kind === 'login-required') return <LoginPage configured={status.configured} error={error} />

  const logout = async () => {
    try { await fetch(`${API_BASE}api/auth/logout`, { method: 'POST', credentials: 'same-origin' }) } catch { /* 仍然清掉本機狀態 */ }
    try { localStorage.removeItem(UNLOCK_KEY) } catch { /* ignore */ }
    window.location.reload()
  }

  return <AuthContext.Provider value={{ status, logout }}>{children}</AuthContext.Provider>
}

interface AuthContextValue { status: AuthStatus; logout: () => Promise<void> }
const AuthContext = createContext<AuthContextValue>({ status: { kind: 'optional' }, logout: async () => {} })

/** 網頁標頭上的登入狀態：已登入顯示 email＋登出；尚未用 Google 登入（過渡期仍可密碼解鎖）顯示「Google 登入」入口。 */
export function AccountBadge() {
  const { status, logout } = useContext(AuthContext)
  if (status.kind === 'loading' || status.kind === 'login-required') return null
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-end', maxWidth: '100%', fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steel }}>
      {status.kind === 'in'
        ? (<>
            <span title={status.email} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>👤 {status.email}</span>
            <button onClick={() => { void logout() }} style={linkBtn}>登出</button>
          </>)
        : (<a href={loginUrl()} style={{ ...linkBtn, textDecoration: 'none' }}>🔓 Google 登入</a>)}
    </div>
  )
}

const linkBtn = { background: 'none', border: 'none', padding: 0, color: COLOR.amberDim, cursor: 'pointer', font: 'inherit' } as const

function LoginPage({ configured, error }: { configured: boolean; error: string | null }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLOR.panelDeep, padding: '16px' }}>
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 8, padding: '2.2rem 2.4rem', width: 'min(360px, 100%)', color: COLOR.ink, fontFamily: FONT.body, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', marginBottom: 14 }}>🔒 PERSONAL PORTAL</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: 8 }}>需要登入</div>
        <div style={{ fontSize: '0.75rem', color: COLOR.steelDim, marginBottom: '1.4rem', lineHeight: 1.6 }}>這是個人使用、不公開的入口網站。請以白名單內的 Google 帳號登入。</div>
        {error && <div role="alert" style={{ fontSize: '0.74rem', color: COLOR.crit, marginBottom: 14, lineHeight: 1.6 }}>{error}</div>}
        {configured
          ? <a href={loginUrl()} style={{ display: 'block', textAlign: 'center', padding: '0.7rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: 5, color: COLOR.amber, fontSize: '0.84rem', fontWeight: 600, textDecoration: 'none' }}>以 Google 帳號登入</a>
          : <div style={{ fontSize: '0.74rem', color: COLOR.warn, lineHeight: 1.6 }}>伺服器尚未設定 Google 登入，請管理者檢查 .env（見 docs/google-login.md）。</div>}
      </div>
    </div>
  )
}
