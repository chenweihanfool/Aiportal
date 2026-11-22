// 分岔卡（3.2x）的純函式：把泳道圖的判斷點、題目頁的判斷點條目、或沒有圖解的流程站，
// 轉成「問題＋帶條件箭頭去向」的 Fork。不碰 DOM、不發請求；畫面在 KnowledgeFork.tsx。
// 只讀 knowledgeView.ts／knowledgeIslands.ts 已匯出的型別。

import type { Bullet, FlowDiagram } from './knowledgeView'
import type { Station } from './knowledgeIslands'

export type ForkTone = 'ok' | 'retry' | 'stop' | 'neutral'

const STOP_RE = /駁回|終止|不受理|停止|放棄|撤銷/
const RETRY_RE = /退回|重新|補正|重測|重做|再審/
const OK_RE = /結案|完成|通過|核准|齊全|核定/

/** 結局色：先看 stop、再看 retry（back 也算）、再看 ok、其餘 neutral；判斷範圍＝label＋targetLabel */
export function branchTone(label: string, targetLabel: string, back: boolean): ForkTone {
  const scope = `${label}${targetLabel}`
  if (STOP_RE.test(scope)) return 'stop'
  if (back || RETRY_RE.test(scope)) return 'retry'
  if (OK_RE.test(scope) || label.replace(/\s+/g, '') === '是') return 'ok'
  return 'neutral'
}

export interface ForkBranch { label: string; dest: string; sub?: string; targetId?: string; tone: ForkTone; back: boolean }
export interface Fork { question: string; sub?: string; branches: ForkBranch[]; plain: Bullet[] }

/** 判斷點節點→Fork：節點不存在或不是 decision 回 null；沒有出邊也回 null。分支依目的節點 phase、lane 排序 */
export function forkFromFlow(d: FlowDiagram, nodeId: string): Fork | null {
  const node = d.nodes.find((n) => n.id === nodeId)
  if (!node || node.shape !== 'decision') return null
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  const rows: Array<{ branch: ForkBranch; phase: number; lane: number; i: number }> = []
  d.edges.forEach((e, i) => {
    if (e.from !== nodeId) return
    const target = byId.get(e.to)
    if (!target) return
    const label = e.label ?? '→'
    const branch: ForkBranch = {
      label,
      dest: target.label,
      targetId: target.id,
      tone: branchTone(label, target.label, !!e.back),
      back: !!e.back,
    }
    const sub = d.lanes[target.lane]
    if (sub !== undefined) branch.sub = sub
    rows.push({ branch, phase: target.phase, lane: target.lane, i })
  })
  if (rows.length === 0) return null
  rows.sort((a, b) => a.phase - b.phase || a.lane - b.lane || a.i - b.i)
  const cleaned: ForkBranch[] = rows.map((r) => r.branch)
  const fork: Fork = { question: node.label, branches: cleaned, plain: [] }
  if (node.sub) fork.sub = node.sub
  return fork
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
const STEP_RE = /第\s*(\d+|[一二三四五六七八九十]{1,3})\s*步/

function stepNoIn(text: string): number | null {
  const m = STEP_RE.exec(text)
  if (!m) return null
  const raw = m[1]!
  const n = /^\d+$/.test(raw) ? Number(raw) : CN_NUM[raw]
  return n && n >= 1 && n <= 12 ? n : null
}

interface ForkTarget { id: string; label: string; stepNo?: number }

/** then 對到的目標：先看「第 N 步」，否則取 label ≥2 字且被 then 完整包含者（最長） */
function targetOf(then: string, targets: readonly ForkTarget[]): string | undefined {
  const n = stepNoIn(then)
  if (n !== null) {
    const hit = targets.find((t) => t.stepNo === n)
    if (hit) return hit.id
  }
  let best: ForkTarget | null = null
  let bestLen = 0
  for (const t of targets) {
    const len = [...t.label].length
    if (len < 2 || len <= bestLen || !then.includes(t.label)) continue
    best = t
    bestLen = len
  }
  return best?.id
}

/** 判斷點條目→Fork：有 when／then 的進分支、其餘進 plain；兩者都空回 null。question 固定「遇到這些情況」 */
export function forkFromText(decisions: readonly Bullet[], targets: ReadonlyArray<ForkTarget>): Fork | null {
  const branches: ForkBranch[] = []
  const plain: Bullet[] = []
  for (const b of decisions) {
    if (!b.when || !b.then) { plain.push(b); continue }
    const branch: ForkBranch = { label: b.when, dest: b.then, tone: branchTone(b.when, b.then, false), back: false }
    const targetId = targetOf(b.then, targets)
    if (targetId) branch.targetId = targetId
    branches.push(branch)
  }
  if (branches.length === 0 && plain.length === 0) return null
  return { question: '遇到這些情況', branches, plain }
}

const FLOW_KINDS: ReadonlySet<string> = new Set(['prep', 'step', 'decision'])
const cut = (s: string, n: number): string => [...s].slice(0, n).join('')

/**
 * 沒有圖解時的備援流程：只取 prep／step／decision 站（依原順序，最多 12 站），
 * 每站一 phase、全部 lane 0，相鄰連邊。少於 2 站回 null；產出可直接丟 layoutFlow。
 */
export function fallbackFlow(stations: readonly Station[]): FlowDiagram | null {
  const kept = stations.filter((s) => FLOW_KINDS.has(s.kind)).slice(0, 12)
  if (kept.length < 2) return null
  return {
    type: 'flow',
    version: 1,
    lanes: ['流程'],
    phases: kept.map((s) => cut(s.label, 8)),
    nodes: kept.map((s, i) => ({
      id: s.id,
      label: cut(s.label, 14),
      src: [],
      lane: 0,
      phase: i,
      shape: s.kind === 'decision' ? 'decision' : 'step',
    })),
    edges: kept.slice(1).map((s, i) => ({ from: kept[i]!.id, to: s.id })),
  }
}
