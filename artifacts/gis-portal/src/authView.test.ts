import { describe, expect, it } from 'vitest'
import { interpretMe, loginErrorMessage } from './authView'

describe('interpretMe', () => {
  it('recognises a logged-in session', () => {
    expect(interpretMe(200, { email: 'me@gmail.com', loginRequired: true })).toEqual({ kind: 'in', email: 'me@gmail.com' })
  })
  it('requires a login screen only when the server enforces it', () => {
    expect(interpretMe(401, { loginRequired: true, configured: true })).toEqual({ kind: 'login-required', configured: true })
    expect(interpretMe(401, { loginRequired: true, configured: false })).toEqual({ kind: 'login-required', configured: false })
  })
  it('keeps the old behaviour when login is optional, absent or the call fails', () => {
    expect(interpretMe(401, { loginRequired: false })).toEqual({ kind: 'optional' })
    expect(interpretMe(404, null)).toEqual({ kind: 'optional' })
    expect(interpretMe(500, 'oops')).toEqual({ kind: 'optional' })
    expect(interpretMe(200, {})).toEqual({ kind: 'optional' })
  })
})

describe('loginErrorMessage', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(loginErrorMessage(null)).toBeNull()
    expect(loginErrorMessage('denied')).toContain('白名單')
    expect(loginErrorMessage('whatever')).toContain('失敗')
  })
})
