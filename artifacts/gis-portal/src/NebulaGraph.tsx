// 知識圖譜星雲圖（#nebula）— LightRAG/Neo4j 的實體關係，用 3d-force-graph 呈球體。
// 節點大小＝degree，顏色＝entity_type；點擊節點開右側詳情（含鄰居清單）。
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from '3d-force-graph'
import { COLOR, FONT } from './theme'

interface NebulaNode {
  id: string
  name: string
  type: string
  val: number
  description?: string
  x?: number; y?: number; z?: number
}
interface NebulaLink { source: string; target: string; label?: string }
interface NebulaPayload { nodes: NebulaNode[]; links: NebulaLink[]; meta?: { computedAt?: string }; error?: string }

const TYPE_COLORS: Record<string, string> = {
  person: '#f0a94c',
  event: '#5aa9e6',
  case: '#c084fc',
  object: '#4ade80',
  concept: '#f472b6',
  method: '#22d3ee',
  organization: '#facc15',
  location: '#34d399',
  data: '#94a3b8',
  content: '#94a3b8',
}
const colorOf = (t: string) => TYPE_COLORS[t] ?? '#9aa4b2'

export function NebulaGraph({ adminPassword, onBack }: { adminPassword: string; onBack: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [payload, setPayload] = useState<NebulaPayload | null>(null)
  const [selected, setSelected] = useState<NebulaNode | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch('/api/graph/nebula', { headers: { 'x-admin-password': adminPassword } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<NebulaPayload> })
      .then(d => { if (alive) { setPayload(d); setError(d.error ?? '') } })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [adminPassword])

  const neighbours = useMemo(() => {
    if (!payload || !selected) return []
    const byId = new Map(payload.nodes.map(n => [n.id, n]))
    return payload.links
      .filter(l => l.source === selected.id || l.target === selected.id)
      .map(l => byId.get(l.source === selected.id ? l.target : l.source))
      .filter((n): n is NebulaNode => !!n)
  }, [payload, selected])

  useEffect(() => {
    if (!mountRef.current || !payload || payload.nodes.length === 0) return
    const el = mountRef.current
    const graph = (ForceGraph3D as any)()(el)
    graphRef.current = graph
    graph
      .backgroundColor('#07080c')
      .graphData(payload)
      .nodeId('id')
      .nodeVal((n: NebulaNode) => Math.max(1, n.val))
      .nodeRelSize(5)
      .nodeLabel((n: NebulaNode) => `${n.name} · ${n.type} · ${n.val}`)
      .nodeColor((n: NebulaNode) => colorOf(n.type))
      .nodeOpacity(0.92)
      .linkColor(() => 'rgba(150,170,200,0.28)')
      .linkWidth(0.4)
      .linkDirectionalParticles(1)
      .linkDirectionalParticleWidth(0.6)
      .onNodeClick((n: NebulaNode) => {
        setSelected(n)
        const r = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) || 1
        graph.cameraPosition(
          { x: ((n.x ?? 0) * 90) / r, y: ((n.y ?? 0) * 90) / r, z: ((n.z ?? 0) * 90) / r },
          n,
          1200,
        )
      })
      .warmupTicks(30)
      .cooldownTime(6000)

    graph.d3Force('charge')?.strength(-110)
    const resize = () => graph.width(el.clientWidth).height(el.clientHeight)
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      graph._destructor?.()
      graphRef.current = null
    }
  }, [payload])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#07080c', display: 'flex', flexDirection: 'column', zIndex: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${COLOR.line}`, flexWrap: 'wrap' }}>
        <span onClick={onBack} style={{ cursor: 'pointer', color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem' }}>← 返回儀表板</span>
        <strong style={{ color: COLOR.amber, fontFamily: FONT.body, fontSize: '0.9rem' }}>知識圖譜星雲</strong>
        <span style={{ color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: '0.7rem' }}>
          {payload ? `${payload.nodes.length} 節點 / ${payload.links.length} 關聯` : '載入中…'}
        </span>
        <span style={{ marginLeft: 'auto', color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: '0.66rem' }}>
          {payload?.meta?.computedAt ? `更新 ${payload.meta.computedAt.slice(0, 19).replace('T', ' ')}` : ''}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={mountRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {loading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: COLOR.steelDim, fontFamily: FONT.mono }}>讀取圖譜中…</div>}
          {error && <div style={{ position: 'absolute', left: 16, bottom: 16, color: '#f87171', fontFamily: FONT.mono, fontSize: '0.75rem' }}>{error}</div>}
        </div>
        {selected && (
          <aside style={{ width: 320, borderLeft: `1px solid ${COLOR.line}`, background: COLOR.panelDeep, padding: '1rem', overflowY: 'auto' }}>
            <div style={{ color: COLOR.amber, fontFamily: FONT.body, fontSize: '1rem', fontWeight: 700, wordBreak: 'break-all' }}>{selected.name}</div>
            <div style={{ color: colorOf(selected.type), fontFamily: FONT.mono, fontSize: '0.72rem', margin: '0.35rem 0 0.8rem' }}>
              {selected.type} · degree {selected.val}
            </div>
            {selected.description && (
              <p style={{ color: '#c7ccd4', fontFamily: FONT.body, fontSize: '0.78rem', lineHeight: 1.55 }}>{selected.description}</p>
            )}
            <div style={{ marginTop: '1rem', color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: '0.68rem', letterSpacing: '0.05em' }}>鄰居（{neighbours.length}）</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
              {neighbours.map(n => (
                <li key={n.id} onClick={() => setSelected(n)}
                  style={{ cursor: 'pointer', padding: '0.3rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#aab2bf', fontFamily: FONT.body, fontSize: '0.75rem' }}>
                  <span style={{ color: colorOf(n.type), marginRight: 6 }}>●</span>{n.name}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setSelected(null)}
              style={{ marginTop: '1rem', background: 'none', border: `1px solid ${COLOR.line}`, color: COLOR.steelDim, padding: '0.3rem 0.7rem', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.68rem' }}>
              關閉
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
