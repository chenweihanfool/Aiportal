import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNLOCK_KEY, clearUnlock, readUnlock, writeUnlock } from './portalApi'

// 瀏覽器封鎖網站儲存時，讀寫都會丟例外；三支函式都不能把例外漏出去。
const boomStorage = {
  getItem: (): string | null => { throw new Error('denied') },
  setItem: (): void => { throw new Error('denied') },
  removeItem: (): void => { throw new Error('denied') },
}

function memStorage(init: Record<string, string> = {}) {
  const data = { ...init }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

describe('解鎖狀態的儲存', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('儲存被封鎖時三支都不丟例外，readUnlock 回 null', () => {
    vi.stubGlobal('localStorage', boomStorage)
    expect(() => readUnlock()).not.toThrow()
    expect(readUnlock()).toBeNull()
    expect(() => writeUnlock('token-1')).not.toThrow()
    expect(() => clearUnlock()).not.toThrow()
  })

  it('正常儲存：寫入讀得回來、清除後回 null', () => {
    const s = memStorage()
    vi.stubGlobal('localStorage', s)
    writeUnlock('token-1')
    expect(s.data[UNLOCK_KEY]).toBe('token-1')
    expect(readUnlock()).toBe('token-1')
    clearUnlock()
    expect(readUnlock()).toBeNull()
  })
})
