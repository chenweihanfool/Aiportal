import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import './portal.css'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const UNLOCK_KEY = 'portal_unlocked'

// Position pools — private sites go right side (+X), public sites go left side (-X)
const PRIVATE_POSITION_POOL: [number, number][] = [
  [4.0, 1.5], [5.5, 3.5], [3.5, -1.0], [6.0, -2.5],
  [4.5, 5.0], [2.5, 3.8], [5.0, 0.2], [6.5, 2.5],
]
const PUBLIC_POSITION_POOL: [number, number][] = [
  [-3.0, -1.5], [-5.0, 1.0], [-3.5, 3.5], [-4.5, -3.0],
  [-2.0, 2.5], [-5.5, -1.8], [-2.5, -3.5], [-4.0, 4.0],
]

// ─────────────────────────────────────────────
// Version History  (update this before each release)
// ─────────────────────────────────────────────
const VERSION_HISTORY = [
  {
    version: '1.3.0',
    date: '2026-03-25',
    summary: '後端資料庫 · 公私分區',
    changes: [
      '網站資料遷移至後端 PostgreSQL 資料庫',
      '管理 CRUD 操作透過 REST API 持久化',
      '公領域 / 私領域地標分區顯示（左右分區）',
      '新增場景區域標示',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-03-25',
    summary: '點擊進入 · 後台管理 · 版本紀錄',
    changes: [
      '點擊3D地標直接進入系統，無需懸停按鈕',
      '新增首頁版本紀錄面板',
      '新增管理後台（CRUD 網站、公私領域設定）',
      '標題改為 AI工具入口網',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-03-25',
    summary: '地標標籤 · 私領域保護',
    changes: [
      '地標旁常駐顯示系統名稱',
      '新增公領域 / 私領域分類標示',
      '私領域網站密碼保護，設備一次驗證即記憶',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-25',
    summary: '初始發布',
    changes: [
      '3D 點雲地形場景（Three.js + React Three Fiber）',
      '6 個專案地標，滑鼠懸停互動效果',
      '玻璃質感資訊卡片，自動旋轉場景',
    ],
  },
]

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface SiteLink {
  label: string
  url: string
}

interface SiteData {
  id: string
  name: string
  subtitle: string
  links: SiteLink[]
  worldXZ: [number, number]
  isPrivate: boolean
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
async function apiFetchSites(): Promise<SiteData[]> {
  const r = await fetch('/api/sites')
  if (!r.ok) throw new Error('Failed to fetch sites')
  const data = await r.json() as { sites: SiteData[] }
  return data.sites
}

async function apiVerifyPassword(password: string): Promise<boolean> {
  const r = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return r.ok
}

async function apiAddSite(data: Omit<SiteData, 'id'>, adminPassword: string): Promise<SiteData> {
  const r = await fetch('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to create site')
  const json = await r.json() as { site: SiteData }
  return json.site
}

async function apiUpdateSite(id: string, data: Partial<Omit<SiteData, 'id'>>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`/api/sites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to update site')
  const json = await r.json() as { site: SiteData }
  return json.site
}

async function apiDeleteSite(id: string, adminPassword: string): Promise<void> {
  const r = await fetch(`/api/sites/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to delete site')
}

function nextPosition(existing: SiteData[], isPrivate: boolean): [number, number] {
  const pool = isPrivate ? PRIVATE_POSITION_POOL : PUBLIC_POSITION_POOL
  const used = new Set(existing.map(s => `${s.worldXZ[0]},${s.worldXZ[1]}`))
  for (const p of pool) {
    if (!used.has(`${p[0]},${p[1]}`)) return p
  }
  const sign = isPrivate ? 1 : -1
  return [sign * (3 + Math.random() * 3), (Math.random() - 0.5) * 6]
}

// ─────────────────────────────────────────────
// Terrain height function
// ─────────────────────────────────────────────
function getHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.5) * Math.cos(z * 0.3) * 2.0 +
    Math.sin(x * 0.2 + z * 0.4) * 1.5 +
    Math.cos(x * 0.7 + z * 0.2) * 1.0
  )
}

// ─────────────────────────────────────────────
// 3D Scene Components
// ─────────────────────────────────────────────
function Terrain() {
  const SEGS = 100
  const SIZE = 22
  const { positions, colors } = useMemo(() => {
    const count = (SEGS + 1) * (SEGS + 1)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    let i = 0
    for (let ix = 0; ix <= SEGS; ix++) {
      for (let iz = 0; iz <= SEGS; iz++) {
        const x = (ix / SEGS - 0.5) * SIZE
        const z = (iz / SEGS - 0.5) * SIZE
        const h = getHeight(x, z)
        positions[i * 3] = x; positions[i * 3 + 1] = h; positions[i * 3 + 2] = z
        const t = Math.max(0, Math.min(1, (h + 4.5) / 9.0))
        colors[i * 3] = t * 0.25; colors[i * 3 + 1] = 0.45 + t * 0.55; colors[i * 3 + 2] = 0.65 + t * 0.35
        i++
      }
    }
    return { positions, colors }
  }, [])
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} vertexColors sizeAttenuation transparent opacity={0.88} />
    </points>
  )
}

function FloatingParticles() {
  const ref = useRef<THREE.Points>(null)
  const count = 700
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 24
      arr[i * 3 + 1] = Math.random() * 6 + 0.5
      arr[i * 3 + 2] = (Math.random() - 0.5) * 24
    }
    return arr
  }, [])
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.018
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.12) * 0.25
    }
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} color="#7fffd4" sizeAttenuation transparent opacity={0.45} />
    </points>
  )
}

// ─────────────────────────────────────────────
// Vortex / tornado particles orbiting each landmark
// ─────────────────────────────────────────────
const FLAKE_COUNT = 28
const MAX_H = 4.0

function SnowflakeRing({ hovered }: { hovered: boolean }) {
  const ref = useRef<THREE.Points>(null)
  // 0 = calm drift, 1 = full tornado; ramps smoothly each frame
  const wind = useRef(0)
  // reusable Color objects to avoid GC pressure inside useFrame
  const calmColor = useRef(new THREE.Color('#c8eeff'))
  const stormColor = useRef(new THREE.Color('#ffddb0'))

  const { baseAngles, radii, baseHeights, driftSpeeds, phases } = useMemo(() => {
    const baseAngles  = new Float32Array(FLAKE_COUNT)
    const radii       = new Float32Array(FLAKE_COUNT)
    const baseHeights = new Float32Array(FLAKE_COUNT)
    const driftSpeeds = new Float32Array(FLAKE_COUNT)
    const phases      = new Float32Array(FLAKE_COUNT)
    for (let i = 0; i < FLAKE_COUNT; i++) {
      baseAngles[i]  = (i / FLAKE_COUNT) * Math.PI * 2
      radii[i]       = 0.25 + Math.random() * 0.38
      baseHeights[i] = Math.random() * MAX_H
      driftSpeeds[i] = 0.20 + Math.random() * 0.35
      phases[i]      = Math.random() * Math.PI * 2
    }
    return { baseAngles, radii, baseHeights, driftSpeeds, phases }
  }, [])

  const positions = useMemo(() => new Float32Array(FLAKE_COUNT * 3), [])

  useFrame(({ clock }, delta) => {
    if (!ref.current) return

    // ── wind ramp: 0 = calm, 1 = tornado ──────────────────────────────────
    const targetWind = hovered ? 1 : 0
    wind.current += (targetWind - wind.current) * Math.min(delta * 2.8, 1)
    const w = wind.current

    const t   = clock.elapsedTime
    const pos = ref.current.geometry.attributes['position'] as THREE.BufferAttribute

    for (let i = 0; i < FLAKE_COUNT; i++) {
      const spd = driftSpeeds[i]

      // ── spin speed: 0.55 idle → 5.5 full tornado ─────────────────────
      const spin  = 0.55 + w * 4.95
      const angle = baseAngles[i] + t * spd * spin

      // ── vertical drift: gentle fall when calm, fast spiral-UP in tornado ─
      // netFall > 0 → downward; at w=0.5 → hover; w=1 → fast upward
      const fallMag  = (0.35 + w * 1.4) * spd
      const netFall  = fallMag * (1 - w * 2.1)           // crosses zero ~w=0.48
      const hPos = ((baseHeights[i] - t * netFall + phases[i] * MAX_H) % MAX_H + MAX_H) % MAX_H

      // ── radius: loose orbit idle → tight funnel at base, wide at top ─
      const idleR    = radii[i] + 0.07 * Math.sin(t * spd + phases[i])
      const vortexR  = 0.05 + (hPos / MAX_H) * 0.72   // tornado funnel shape
      const r        = idleR * (1 - w) + vortexR * w

      pos.setXYZ(i, Math.cos(angle) * r, hPos, Math.sin(angle) * r)
    }
    pos.needsUpdate = true

    // ── material: animate size, opacity, and colour ───────────────────────
    const mat   = ref.current.material as THREE.PointsMaterial
    mat.size    = 0.046 + w * 0.060
    mat.opacity = 0.44  + w * 0.52
    mat.color.lerpColors(calmColor.current, stormColor.current, w * 0.65)
    mat.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.046}
        color="#c8eeff"
        sizeAttenuation
        transparent
        opacity={0.44}
      />
    </points>
  )
}

function ZoneLabel({ position, text, color }: { position: [number, number, number]; text: string; color: string }) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }}>
      <div style={{
        color,
        fontSize: '10px',
        fontWeight: '300',
        letterSpacing: '0.45em',
        textTransform: 'uppercase',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        whiteSpace: 'nowrap',
        opacity: 0.38,
        userSelect: 'none',
      }}>
        {text}
      </div>
    </Html>
  )
}

function Landmark({
  site,
  onSiteClick,
  onUrlClick,
}: {
  site: SiteData
  onSiteClick: (site: SiteData) => void
  onUrlClick: (url: string, isPrivate: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const [wx, wz] = site.worldXZ
  const wy = getHeight(wx, wz)

  const handleEnter = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    setHovered(true)
  }, [])
  const handleLeave = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => setHovered(false), 280)
  }, [])

  const handlePointerDown = useCallback((e: { clientX: number; clientY: number }) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleClick = useCallback((e: { clientX: number; clientY: number }) => {
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x)
      const dy = Math.abs(e.clientY - pointerDownPos.current.y)
      if (dx > 6 || dy > 6) return
    }
    onSiteClick(site)
  }, [site, onSiteClick])

  useFrame(() => {
    if (!groupRef.current) return
    const target = hovered ? 1.28 : 1.0
    const s = groupRef.current.scale.x
    groupRef.current.scale.setScalar(s + (target - s) * 0.11)
  })

  const col = hovered ? '#ffaa00' : '#00e5ff'
  const emi = hovered ? '#ff6600' : '#009abb'
  const labelColor = site.isPrivate ? '#c084fc' : '#00e5ff'
  const labelGlow = site.isPrivate
    ? 'rgba(192, 132, 252, 0.85), 0 0 22px rgba(192, 132, 252, 0.4)'
    : 'rgba(0, 229, 255, 0.9), 0 0 22px rgba(0, 229, 255, 0.45)'
  const labelBorder = site.isPrivate ? 'rgba(192, 132, 252, 0.22)' : 'rgba(0, 229, 255, 0.22)'
  const secondaryLinks = site.links.slice(1)

  return (
    <group ref={groupRef} position={[wx, wy, wz]}>
      {/* Invisible hit volume */}
      <mesh
        position={[0, 1.6, 0]}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <cylinderGeometry args={[0.48, 0.48, 3.5, 8]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>

      {/* Pillar */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 3.2, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={4} transparent opacity={0.92} />
      </mesh>

      {/* Inverted cone tip */}
      <mesh position={[0, 3.35, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.21, 0.72, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={6} transparent opacity={0.88} />
      </mesh>

      {/* Glow sphere */}
      <mesh position={[0, 3.1, 0]}>
        <sphereGeometry args={[0.11, 8, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={8} transparent opacity={0.55} />
      </mesh>

      <pointLight color={col} intensity={hovered ? 6 : 2.5} distance={5.5} position={[0, 3.1, 0]} />

      {/* Snowflake drift particles */}
      <SnowflakeRing hovered={hovered} />

      {/* Always-visible name label */}
      <Html center position={[0, 4.35, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          color: labelColor,
          fontSize: '11px',
          fontWeight: '500',
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
          textShadow: `0 0 10px ${labelGlow}`,
          background: 'rgba(5, 8, 20, 0.55)',
          padding: '3px 9px',
          borderRadius: '5px',
          border: `1px solid ${labelBorder}`,
          userSelect: 'none',
        }}>
          {site.name}
        </div>
      </Html>

      {/* Hover info card */}
      {hovered && (
        <Html position={[0.75, 2.6, 0]} style={{ pointerEvents: 'none' }}>
          <div
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            style={{
              pointerEvents: 'auto',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: '14px',
              padding: '16px 20px',
              width: '210px',
              color: 'white',
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              boxShadow: '0 0 40px rgba(0, 229, 255, 0.12), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            <div style={{
              fontSize: '10px',
              color: site.isPrivate ? 'rgba(192, 132, 252, 0.75)' : 'rgba(0, 229, 255, 0.65)',
              letterSpacing: '0.18em', marginBottom: '6px',
              textTransform: 'uppercase', fontWeight: '500',
            }}>
              {site.isPrivate ? '🔒 私領域' : '🌐 公領域'}
            </div>
            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '3px', lineHeight: '1.4', color: 'rgba(255,255,255,0.95)' }}>
              {site.name}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.03em' }}>
              {site.subtitle}
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '10px', letterSpacing: '0.05em' }}>
              點擊地標直接進入
            </div>
            {secondaryLinks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                {secondaryLinks.map(link => (
                  <button
                    key={link.url}
                    onClick={() => onUrlClick(link.url, site.isPrivate)}
                    style={{
                      display: 'block', width: '100%',
                      padding: '7px 12px',
                      background: 'rgba(0, 229, 255, 0.06)',
                      border: '1px solid rgba(0, 229, 255, 0.22)',
                      borderRadius: '7px',
                      color: 'rgba(0,229,255,0.8)',
                      fontSize: '11px', fontWeight: '500',
                      letterSpacing: '0.04em', textAlign: 'center',
                      cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,0.14)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.45)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,229,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.22)' }}
                  >
                    {link.label} ↗
                  </button>
                ))}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

function Scene({
  sites,
  onSiteClick,
  onUrlClick,
}: {
  sites: SiteData[]
  onSiteClick: (site: SiteData) => void
  onUrlClick: (url: string, isPrivate: boolean) => void
}) {
  return (
    <>
      <color attach="background" args={['#050814']} />
      <fog attach="fog" args={['#050814', 30, 46]} />
      <ambientLight intensity={0.15} />
      <Terrain />
      <FloatingParticles />

      {/* Zone labels — always visible */}
      <ZoneLabel position={[5.0, 7.0, 1.0]} text="私 領 域" color="rgba(192,132,252,1)" />
      <ZoneLabel position={[-4.0, 7.0, 0.5]} text="公 領 域" color="rgba(0,229,255,1)" />

      {/* Landmarks — appear once data is loaded from API */}
      {sites.map(s => (
        <Landmark key={s.id} site={s} onSiteClick={onSiteClick} onUrlClick={onUrlClick} />
      ))}

      <OrbitControls
        autoRotate autoRotateSpeed={0.4}
        enableDamping dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.15} minPolarAngle={0.18}
        minDistance={8} maxDistance={32}
      />
    </>
  )
}

// ─────────────────────────────────────────────
// Password Modal (private site access)
// ─────────────────────────────────────────────
function PasswordModal({
  pendingUrl,
  onSuccess,
  onCancel,
}: {
  pendingUrl: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      localStorage.setItem(UNLOCK_KEY, '1')
      window.open(pendingUrl, '_blank', 'noopener,noreferrer')
      onSuccess()
    } else {
      setError('密碼錯誤，請再試一次')
      setInput('')
    }
  }

  const card: React.CSSProperties = {
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '20px', padding: '40px 44px', width: '340px',
    color: 'white', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    boxShadow: '0 0 80px rgba(192,132,252,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={card}>
        <div style={{ fontSize: '10px', color: 'rgba(192,132,252,0.75)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '14px', fontWeight: '500' }}>
          🔒 私領域網站
        </div>
        <div style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>輸入密碼</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.42)', marginBottom: '28px', lineHeight: '1.6' }}>
          此為私領域網站，請輸入密碼以繼續。<br />本裝置驗證後將不再詢問。
        </div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input
            type="password" value={input} autoFocus placeholder="••••••"
            disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{
              width: '100%', padding: '12px 16px', background: 'rgba(0,0,0,0.35)',
              border: `1px solid ${error ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.14)'}`,
              borderRadius: '10px', color: 'white', fontSize: '15px',
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em',
            }}
          />
          {error && <div style={{ fontSize: '12px', color: 'rgba(248,113,113,0.9)', marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" onClick={onCancel}
              style={{ flex: 1, padding: '11px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
              取消
            </button>
            <button type="submit" disabled={loading}
              style={{ flex: 2, padding: '11px', background: 'rgba(192,132,252,0.14)', border: '1px solid rgba(192,132,252,0.38)', borderRadius: '10px', color: '#c084fc', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '確認進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Admin Panel
// ─────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  padding: '9px 12px', background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
  color: 'white', fontSize: '13px',
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  outline: 'none', boxSizing: 'border-box', width: '100%',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  )
}

const BLANK_FORM = (): Omit<SiteData, 'id' | 'worldXZ'> => ({
  name: '', subtitle: '', links: [{ label: '進入系統', url: '' }], isPrivate: false,
})

interface AdminPanelProps {
  sites: SiteData[]
  adminPassword: string
  onAdd: (data: Omit<SiteData, 'id'>) => Promise<void>
  onEdit: (id: string, data: Partial<Omit<SiteData, 'id'>>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

function AdminPanel({ sites, adminPassword, onAdd, onEdit, onDelete, onClose }: AdminPanelProps) {
  const [editing, setEditing] = useState<SiteData | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_FORM())
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')

  void adminPassword

  const openEdit = (s: SiteData) => {
    setEditing(s); setAdding(false); setApiError('')
    setForm({ name: s.name, subtitle: s.subtitle, links: s.links.map(l => ({ ...l })), isPrivate: s.isPrivate })
  }
  const openAdd = () => {
    setAdding(true); setEditing(null); setApiError('')
    setForm(BLANK_FORM())
  }
  const closeForm = () => { setEditing(null); setAdding(false); setApiError('') }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await onDelete(id)
      setConfirmDelete(null)
      if (editing?.id === id) closeForm()
    } catch {
      setApiError('刪除失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const links = form.links.filter(l => l.url.trim())
    if (!form.name.trim() || links.length === 0) return
    setBusy(true)
    setApiError('')
    try {
      if (adding) {
        const worldXZ = nextPosition(sites, form.isPrivate)
        await onAdd({ name: form.name.trim(), subtitle: form.subtitle.trim(), links, worldXZ, isPrivate: form.isPrivate })
      } else if (editing) {
        await onEdit(editing.id, { name: form.name.trim(), subtitle: form.subtitle.trim(), links, isPrivate: form.isPrivate })
      }
      closeForm()
    } catch {
      setApiError('儲存失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const setLink = (idx: number, field: keyof SiteLink, val: string) =>
    setForm(f => { const links = f.links.map((l, i) => i === idx ? { ...l, [field]: val } : l); return { ...f, links } })

  const addLink = () => setForm(f => ({ ...f, links: [...f.links, { label: '', url: '' }] }))
  const removeLink = (idx: number) => setForm(f => ({ ...f, links: f.links.filter((_, i) => i !== idx) }))

  const showForm = adding || editing !== null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
      <div style={{
        width: '680px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '20px', padding: '32px 36px',
        color: 'white', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(0,229,255,0.6)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>網站管理</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}>
            關閉
          </button>
        </div>

        {apiError && (
          <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '8px', fontSize: '12px', color: 'rgba(248,113,113,0.9)' }}>
            {apiError}
          </div>
        )}

        {/* Zone legend */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: 'rgba(0,229,255,0.55)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e5ff', display: 'inline-block', opacity: 0.7 }} />
            公領域 — 場景左側
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(192,132,252,0.55)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c084fc', display: 'inline-block', opacity: 0.7 }} />
            私領域 — 場景右側
          </div>
        </div>

        {/* Site list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {sites.map(s => (
            <div key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 16px',
                background: editing?.id === s.id ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${editing?.id === s.id ? 'rgba(0,229,255,0.22)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: confirmDelete === s.id ? '10px 10px 0 0' : '10px',
              }}>
                <span style={{
                  fontSize: '10px', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap',
                  background: s.isPrivate ? 'rgba(192,132,252,0.12)' : 'rgba(0,229,255,0.1)',
                  color: s.isPrivate ? '#c084fc' : '#00e5ff',
                  border: `1px solid ${s.isPrivate ? 'rgba(192,132,252,0.28)' : 'rgba(0,229,255,0.28)'}`,
                }}>
                  {s.isPrivate ? '私' : '公'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.32)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.links[0]?.url}</div>
                </div>
                <button onClick={() => openEdit(s)} disabled={busy} style={{ padding: '6px 12px', background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: '7px', color: '#00e5ff', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  編輯
                </button>
                <button
                  onClick={() => setConfirmDelete(confirmDelete === s.id ? null : s.id)}
                  disabled={busy}
                  style={{ padding: '6px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '7px', color: '#f87171', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  刪除
                </button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
                  <span style={{ flex: 1, fontSize: '12px', color: 'rgba(248,113,113,0.85)' }}>確定刪除「{s.name}」？</span>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                  <button onClick={() => { void handleDelete(s.id) }} disabled={busy} style={{ padding: '5px 12px', background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '6px', color: '#f87171', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>確定刪除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showForm && (
          <button onClick={openAdd} disabled={busy} style={{ width: '100%', padding: '11px', background: 'rgba(0,229,255,0.06)', border: '1px dashed rgba(0,229,255,0.28)', borderRadius: '10px', color: '#00e5ff', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.06em' }}>
            ＋ 新增網站
          </button>
        )}

        {showForm && (
          <div style={{ marginTop: '12px', padding: '22px 24px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginBottom: '18px' }}>
              {adding ? '新增網站' : '編輯網站'}
            </div>

            <FormField label="名稱">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="系統名稱" style={inputSt} />
            </FormField>

            <FormField label="副標題（選填）">
              <input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="English subtitle" style={inputSt} />
            </FormField>

            <FormField label="領域設定">
              <div style={{ display: 'flex', gap: '8px' }}>
                {([false, true] as const).map(priv => (
                  <button key={String(priv)} onClick={() => setForm(f => ({ ...f, isPrivate: priv }))}
                    style={{
                      padding: '7px 18px',
                      background: form.isPrivate === priv ? (priv ? 'rgba(192,132,252,0.18)' : 'rgba(0,229,255,0.14)') : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${form.isPrivate === priv ? (priv ? 'rgba(192,132,252,0.5)' : 'rgba(0,229,255,0.45)') : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '7px',
                      color: form.isPrivate === priv ? (priv ? '#c084fc' : '#00e5ff') : 'rgba(255,255,255,0.4)',
                      fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {priv ? '🔒 私領域（右側）' : '🌐 公領域（左側）'}
                  </button>
                ))}
              </div>
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: '8px' }}>連結</div>
              {form.links.map((link, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input value={link.label} onChange={e => setLink(idx, 'label', e.target.value)} placeholder="按鈕文字" style={{ ...inputSt, width: '100px', flex: '0 0 100px' }} />
                  <input value={link.url} onChange={e => setLink(idx, 'url', e.target.value)} placeholder="https://..." style={{ ...inputSt, flex: 1 }} />
                  {form.links.length > 1 && (
                    <button onClick={() => removeLink(idx)} style={{ background: 'none', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '7px', color: 'rgba(248,113,113,0.7)', padding: '0 10px', cursor: 'pointer', fontSize: '16px', fontFamily: 'inherit', flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {form.links.length < 3 && (
                <button onClick={addLink} style={{ fontSize: '11px', color: 'rgba(0,229,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', letterSpacing: '0.04em' }}>
                  ＋ 新增連結
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={closeForm} disabled={busy} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '9px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                取消
              </button>
              <button onClick={() => { void handleSave() }} disabled={busy} style={{ flex: 2, padding: '10px', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.38)', borderRadius: '9px', color: '#00e5ff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                {busy ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Admin Auth Modal — verifies via API
// ─────────────────────────────────────────────
function AdminAuthModal({ onSuccess, onCancel }: { onSuccess: (pw: string) => void; onCancel: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      onSuccess(input)
    } else {
      setError('通行碼錯誤')
      setInput('')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '20px', padding: '36px 40px', width: '320px', color: 'white', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <div style={{ fontSize: '10px', color: 'rgba(0,229,255,0.6)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '12px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>輸入通行碼</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input type="password" value={input} autoFocus placeholder="••••••••"
            disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{ width: '100%', padding: '11px 14px', background: 'rgba(0,0,0,0.35)', border: `1px solid ${error ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.14)'}`, borderRadius: '9px', color: 'white', fontSize: '15px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em' }} />
          {error && <div style={{ fontSize: '12px', color: 'rgba(248,113,113,0.9)', marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '9px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '10px', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.35)', borderRadius: '9px', color: '#00e5ff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Version History Panel
// ─────────────────────────────────────────────
function VersionHistory() {
  const [expanded, setExpanded] = useState(false)
  const latest = VERSION_HISTORY[0]
  return (
    <div style={{ position: 'absolute', bottom: '1.5rem', left: '1.5rem', zIndex: 100, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
      <button onClick={() => setExpanded(x => !x)} style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(5,8,20,0.75)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
        padding: '8px 14px', cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit',
        color: 'rgba(255,255,255,0.7)',
      }}>
        <span style={{ color: '#00e5ff', fontWeight: '600' }}>v{latest.version}</span>
        <span style={{ color: 'rgba(255,255,255,0.38)' }}>{latest.summary}</span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', marginLeft: '2px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: '8px', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
          padding: '18px 20px', width: '290px', maxHeight: '60vh', overflowY: 'auto',
        }}>
          {VERSION_HISTORY.map((v, vi) => (
            <div key={v.version} style={{ marginBottom: vi < VERSION_HISTORY.length - 1 ? '18px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#00e5ff' }}>v{v.version}</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.32)', letterSpacing: '0.04em' }}>{v.date}</span>
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 14px' }}>
                {v.changes.map((c, ci) => (
                  <li key={ci} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.58)', lineHeight: '1.7' }}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const [sites, setSites] = useState<SiteData[]>([])
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(UNLOCK_KEY) === '1')
  const [modal, setModal] = useState<{ visible: boolean; pendingUrl: string }>({ visible: false, pendingUrl: '' })
  const [adminAuth, setAdminAuth] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')

  const refreshSites = useCallback(async () => {
    try {
      const data = await apiFetchSites()
      setSites(data)
    } catch {
      // silently keep whatever we have
    }
  }, [])

  useEffect(() => {
    apiFetchSites()
      .then(data => { setSites(data) })
      .catch(() => { /* keep empty sites on error */ })
  }, [])

  const openUrl = useCallback((url: string, isPrivate: boolean) => {
    if (!isPrivate || unlocked) {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      setModal({ visible: true, pendingUrl: url })
    }
  }, [unlocked])

  const handleSiteClick = useCallback((site: SiteData) => {
    openUrl(site.links[0]?.url ?? '', site.isPrivate)
  }, [openUrl])

  const handleUrlClick = useCallback((url: string, isPrivate: boolean) => {
    openUrl(url, isPrivate)
  }, [openUrl])

  const handleModalSuccess = useCallback(() => {
    setUnlocked(true)
    setModal({ visible: false, pendingUrl: '' })
  }, [])

  const handleAdminAuthSuccess = useCallback((pw: string) => {
    setAdminPassword(pw)
    setAdminAuth(false)
    setAdminOpen(true)
  }, [])

  const handleAdd = useCallback(async (data: Omit<SiteData, 'id'>) => {
    await apiAddSite(data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleEdit = useCallback(async (id: string, data: Partial<Omit<SiteData, 'id'>>) => {
    await apiUpdateSite(id, data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleDelete = useCallback(async (id: string) => {
    await apiDeleteSite(id, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050814', position: 'relative', overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 10, 16], fov: 60, near: 0.1, far: 200 }}
        style={{ display: 'block' }}
        gl={{ antialias: true }}
        fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#00e5ff', fontFamily: 'Helvetica Neue, sans-serif', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>WebGL Not Available</div>
              <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' }}>Please use a modern browser with WebGL support.</div>
            </div>
          </div>
        }
      >
        {/* Scene always renders — terrain & particles visible immediately.
            Landmarks appear as soon as the API fetch resolves (sites.length > 0). */}
        <Scene sites={sites} onSiteClick={handleSiteClick} onUrlClick={handleUrlClick} />
      </Canvas>

      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '2rem 2rem 4rem', textAlign: 'center', pointerEvents: 'none',
        background: 'linear-gradient(to bottom, rgba(5,8,20,0.85) 0%, rgba(5,8,20,0.2) 70%, transparent 100%)',
      }}>
        <h1 style={{
          color: '#00e5ff', fontSize: 'clamp(1.2rem, 3vw, 2rem)',
          fontWeight: '300', letterSpacing: '0.3em', textTransform: 'uppercase',
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          margin: 0, textShadow: '0 0 40px rgba(0, 229, 255, 0.45)',
        }}>
          AI工具入口網
        </h1>
        <p style={{
          color: 'rgba(255,255,255,0.38)', fontSize: '0.7rem',
          letterSpacing: '0.28em', textTransform: 'uppercase',
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          marginTop: '0.55rem', marginBottom: 0,
        }}>
          點擊地標 · 立即進入
        </p>
      </div>

      {/* Bottom hint */}
      <div style={{ position: 'absolute', bottom: '1.5rem', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <p style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', margin: 0 }}>
          Drag to orbit · Scroll to zoom
        </p>
      </div>

      {/* Version history — bottom left */}
      <VersionHistory />

      {/* Admin button — bottom right */}
      <button
        onClick={() => setAdminAuth(true)}
        title="管理後台"
        style={{
          position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
          background: 'rgba(5,8,20,0.75)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
          color: 'rgba(255,255,255,0.4)', fontSize: '18px',
          padding: '8px 12px', cursor: 'pointer', lineHeight: 1,
          transition: 'color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'rgba(0,229,255,0.8)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.3)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
      >
        ⚙
      </button>

      {/* Private site password modal */}
      {modal.visible && (
        <PasswordModal
          pendingUrl={modal.pendingUrl}
          onSuccess={handleModalSuccess}
          onCancel={() => setModal({ visible: false, pendingUrl: '' })}
        />
      )}

      {/* Admin auth */}
      {adminAuth && !adminOpen && (
        <AdminAuthModal
          onSuccess={handleAdminAuthSuccess}
          onCancel={() => setAdminAuth(false)}
        />
      )}

      {/* Admin panel */}
      {adminOpen && (
        <AdminPanel
          sites={sites}
          adminPassword={adminPassword}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  )
}
