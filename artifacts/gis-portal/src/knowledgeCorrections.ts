// 知識頁句子更正（2.85.0）：POST 更正、待生效佇列（localStorage `kn-corr-pending`）、暫定狀態計算。
// 純函式有測試（knowledgeCorrections.test.ts）；網路只有 postCorrection。後端規則見 docs/knowledge-corrections-api.md。
import { displayOf, isFresh, type BulletDisplay, type Topic, type TopicClaim } from './knowledgeView'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export type CorrectionKind = 'wrong' | 'fix' | 'add' | 'undo'
export const MAX_CORRECTION_CHARS = 500
/** 送出超過這麼久（分鐘）還沒生效就算卡住 */
export const STUCK_MIN = 60
export const PENDING_KEY = 'kn-corr-pending'

export interface CorrectionBody { topicId: string; claimId?: string; kind: CorrectionKind; section?: string; text?: string }
export interface CorrectionResult { id: number; topicId: string; claimId: string | null; kind: CorrectionKind; section: string | null; text: string | null; createdAt: string }

/** 非 2xx 丟出帶後端 message 的錯誤 */
export async function postCorrection(pw: string, body: CorrectionBody): Promise<CorrectionResult> {
  const r = await fetch(`${API_BASE}api/knowledge/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
    body: JSON.stringify(body),
  })
  let data: unknown = null
  try { data = await r.json() } catch { /* 沒有 JSON 本文 */ }
  if (!r.ok) {
    const msg = (data as { message?: unknown } | null)?.message
    throw new Error(typeof msg === 'string' && msg ? msg : r.status === 401 ? '沒有權限（請重新解鎖）' : `送出失敗（${r.status}）`)
  }
  return data as CorrectionResult
}

/* ───────── 待生效佇列 ───────── */

export interface PendingItem {
  id: number
  topicId: string
  claimId: string | null
  kind: CorrectionKind
  section: string | null
  text: string | null
  /** 送出時間（epoch ms） */
  at: number
}

export interface PendingStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

const KINDS: readonly string[] = ['wrong', 'fix', 'add', 'undo']

function isPendingItem(v: unknown): v is PendingItem {
  if (!v || typeof v !== 'object') return false
  const x = v as Record<string, unknown>
  return typeof x.id === 'number' && Number.isFinite(x.id) && typeof x.topicId === 'string' && typeof x.kind === 'string' && KINDS.includes(x.kind)
    && (x.claimId === null || typeof x.claimId === 'string') && (x.section === null || typeof x.section === 'string')
    && (x.text === null || typeof x.text === 'string') && typeof x.at === 'number' && Number.isFinite(x.at)
}

/** 讀不到、壞 JSON、不是陣列、store 丟例外都回空清單；壞掉的單筆略過 */
export function loadPending(store: PendingStore | null | undefined): PendingItem[] {
  try {
    const raw = store?.getItem(PENDING_KEY)
    if (!raw) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(isPendingItem) : []
  } catch {
    return []
  }
}

/** 寫入失敗靜默略過，回傳是否成功 */
export function savePending(store: PendingStore | null | undefined, list: readonly PendingItem[]): boolean {
  try {
    if (!store) return false
    store.setItem(PENDING_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** 把 id 已出現在該題 appliedCorrections 的移除，回傳剩下的（找不到題目或沒有 appliedCorrections 的保留） */
export function settle(pending: readonly PendingItem[], topics: readonly Pick<Topic, 'id' | 'appliedCorrections'>[]): PendingItem[] {
  const applied = new Map(topics.map((t) => [t.id, new Set(t.appliedCorrections ?? [])]))
  return pending.filter((p) => !applied.get(p.topicId)?.has(p.id))
}

/** 送出超過 STUCK_MIN 分鐘還沒生效 */
export function isStuck(item: Pick<PendingItem, 'at'>, now: Date): boolean {
  return now.getTime() - item.at > STUCK_MIN * 60_000
}

export interface ClaimOverlayEntry { kind: 'wrong' | 'fix' | 'undo'; text: string | null; item: PendingItem }
export interface ClaimOverlay {
  /** claim id → 目前暫定狀態（同一條多筆以最後一筆為準；只含 claims 裡有的 id） */
  byClaim: Map<string, ClaimOverlayEntry>
  /** 節名 → 待生效的 add（依送出順序） */
  adds: Map<string, PendingItem[]>
}

export function overlay(claims: readonly Pick<TopicClaim, 'id'>[], pendingOfTopic: readonly PendingItem[]): ClaimOverlay {
  const known = new Set(claims.map((c) => c.id))
  const byClaim = new Map<string, ClaimOverlayEntry>()
  const adds = new Map<string, PendingItem[]>()
  for (const p of pendingOfTopic) {
    if (p.kind === 'add') {
      const key = p.section ?? ''
      const arr = adds.get(key)
      if (arr) arr.push(p)
      else adds.set(key, [p])
    } else if (p.claimId && known.has(p.claimId)) {
      byClaim.set(p.claimId, { kind: p.kind, text: p.kind === 'fix' ? p.text : null, item: p })
    }
  }
  return { byClaim, adds }
}

/** 現在是否算「有誤」（暫定狀態優先：只有暫定「不對」才算；沒有暫定就看正式 status） */
export function isWrongNow(claim: Pick<TopicClaim, 'status'>, entry?: Pick<ClaimOverlayEntry, 'kind'> | null): boolean {
  return entry ? entry.kind === 'wrong' : claim.status === 'disputed'
}

export interface ClaimState {
  /** 劃線、淡色（正式有誤或暫定「不對」） */
  wrong: boolean
  /** 📌 你更正的（正式或暫定改寫） */
  mine: boolean
  /** 顯示用文字（已去掉標記；暫定改寫用新文字） */
  display: BulletDisplay
  /** 暫定改寫的文字覆蓋了原本結構（呼叫端應改用純文字顯示） */
  override: boolean
  fresh: boolean
  pending: ClaimOverlayEntry | null
  stuck: boolean
  /** 可以「撤回我的更正」 */
  canUndo: boolean
}

/** 一條 claim 現在該顯示的狀態＝正式狀態疊上待生效的暫定狀態 */
export function claimState(bullet: { text: string }, claim: TopicClaim, entry: ClaimOverlayEntry | undefined, now: Date): ClaimState {
  const official = displayOf(bullet, claim)
  let wrong = isWrongNow(claim, entry)
  let mine = claim.origin === 'user' || claim.pinned
  let display = official
  let override = false
  if (entry) {
    if (entry.kind === 'wrong') wrong = true
    else if (entry.kind === 'fix') {
      wrong = false
      mine = true
      override = true
      display = { text: entry.text ?? official.text, date: null, mark: null }
    } else {
      wrong = false
      mine = false
      if (official.mark === 'disputed') display = { ...official, mark: null, date: null }
    }
  }
  return {
    wrong, mine, display, override,
    fresh: isFresh(claim, now),
    pending: entry ?? null,
    stuck: !!entry && isStuck(entry.item, now),
    canUndo: (mine || wrong) && entry?.kind !== 'undo',
  }
}
