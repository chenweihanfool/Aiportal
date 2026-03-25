import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import { useRef, useState, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import './portal.css'

function getHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.5) * Math.cos(z * 0.3) * 2.0 +
    Math.sin(x * 0.2 + z * 0.4) * 1.5 +
    Math.cos(x * 0.7 + z * 0.2) * 1.0
  )
}

interface ProjectLink {
  label: string
  url: string
}

interface Project {
  id: number
  name: string
  subtitle: string
  links: ProjectLink[]
  worldXZ: [number, number]
}

const PROJECTS: Project[] = [
  {
    id: 1,
    name: '人生進度管理系統',
    subtitle: 'Life Progress Management',
    links: [
      { label: '進入系統', url: 'https://pf-cwh.replit.app/' },
      { label: '再平衡計算器', url: 'https://pf-cwh.replit.app/rebalancer' },
    ],
    worldXZ: [3.0, 0.5],
  },
  {
    id: 2,
    name: '健身追蹤',
    subtitle: 'Fitness Tracking',
    links: [{ label: '進入系統', url: 'https://fitness-forge-chenweihanfool.replit.app/' }],
    worldXZ: [-1.5, 5.0],
  },
  {
    id: 3,
    name: '扭曲的夢境',
    subtitle: 'Twisted Dreams — Art',
    links: [{ label: '進入系統', url: 'https://art-mart--chenweihanfool.replit.app/' }],
    worldXZ: [5.0, 3.0],
  },
  {
    id: 4,
    name: '圖根點管理系統',
    subtitle: 'Survey Control Points',
    links: [{ label: '進入系統', url: 'https://kc2-cwh.replit.app/' }],
    worldXZ: [2.0, -2.0],
  },
  {
    id: 5,
    name: '土地移轉分析系統',
    subtitle: 'Land Transfer Analysis',
    links: [{ label: '進入系統', url: 'https://land-transfer-visualizer.replit.app/' }],
    worldXZ: [4.5, -1.0],
  },
  {
    id: 6,
    name: '案件排程系統',
    subtitle: 'Case Scheduling',
    links: [{ label: '進入系統', url: 'https://map-scheduler.replit.app/' }],
    worldXZ: [-0.5, 4.0],
  },
]

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
        positions[i * 3] = x
        positions[i * 3 + 1] = h
        positions[i * 3 + 2] = z
        const t = Math.max(0, Math.min(1, (h + 4.5) / 9.0))
        colors[i * 3] = t * 0.25
        colors[i * 3 + 1] = 0.45 + t * 0.55
        colors[i * 3 + 2] = 0.65 + t * 0.35
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

function Landmark({ project }: { project: Project }) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [wx, wz] = project.worldXZ
  const wy = getHeight(wx, wz)

  const handleEnter = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    setHovered(true)
  }, [])

  const handleLeave = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => setHovered(false), 280)
  }, [])

  useFrame(() => {
    if (!groupRef.current) return
    const target = hovered ? 1.28 : 1.0
    const s = groupRef.current.scale.x
    const next = s + (target - s) * 0.11
    groupRef.current.scale.set(next, next, next)
  })

  const col = hovered ? '#ffaa00' : '#00e5ff'
  const emi = hovered ? '#ff6600' : '#009abb'

  return (
    <group ref={groupRef} position={[wx, wy, wz]}>
      <mesh position={[0, 1.6, 0]} onPointerEnter={handleEnter} onPointerLeave={handleLeave}>
        <cylinderGeometry args={[0.48, 0.48, 3.5, 8]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>

      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 3.2, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={4} transparent opacity={0.92} />
      </mesh>

      <mesh position={[0, 3.35, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.21, 0.72, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={6} transparent opacity={0.88} />
      </mesh>

      <mesh position={[0, 3.1, 0]}>
        <sphereGeometry args={[0.11, 8, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={8} transparent opacity={0.55} />
      </mesh>

      <pointLight color={col} intensity={hovered ? 6 : 2.5} distance={5.5} position={[0, 3.1, 0]} />

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
              padding: '18px 22px',
              width: '230px',
              color: 'white',
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              boxShadow: '0 0 40px rgba(0, 229, 255, 0.12), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                color: 'rgba(0, 229, 255, 0.65)',
                letterSpacing: '0.18em',
                marginBottom: '8px',
                textTransform: 'uppercase',
                fontWeight: '500',
              }}
            >
              PROJECT {String(project.id).padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: '600',
                marginBottom: '4px',
                lineHeight: '1.4',
                color: 'rgba(255,255,255,0.95)',
              }}
            >
              {project.name}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.45)',
                marginBottom: '18px',
                letterSpacing: '0.04em',
              }}
            >
              {project.subtitle}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {project.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '9px 14px',
                    background: 'rgba(0, 229, 255, 0.08)',
                    border: '1px solid rgba(0, 229, 255, 0.28)',
                    borderRadius: '8px',
                    color: '#00e5ff',
                    fontSize: '12px',
                    fontWeight: '500',
                    letterSpacing: '0.06em',
                    textDecoration: 'none',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    const t = e.currentTarget
                    t.style.background = 'rgba(0, 229, 255, 0.18)'
                    t.style.borderColor = 'rgba(0, 229, 255, 0.55)'
                  }}
                  onMouseLeave={(e) => {
                    const t = e.currentTarget
                    t.style.background = 'rgba(0, 229, 255, 0.08)'
                    t.style.borderColor = 'rgba(0, 229, 255, 0.28)'
                  }}
                >
                  {link.label} →
                </a>
              ))}
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={['#050814']} />
      <fog attach="fog" args={['#050814', 30, 46]} />
      <ambientLight intensity={0.15} />
      <Terrain />
      <FloatingParticles />
      {PROJECTS.map((p) => (
        <Landmark key={p.id} project={p} />
      ))}
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.4}
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.15}
        minPolarAngle={0.18}
        minDistance={8}
        maxDistance={32}
      />
    </>
  )
}

export default function App() {
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
        <Scene />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '2rem 2rem 4rem',
          textAlign: 'center',
          pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(5,8,20,0.85) 0%, rgba(5,8,20,0.2) 70%, transparent 100%)',
        }}
      >
        <h1
          style={{
            color: '#00e5ff',
            fontSize: 'clamp(1.1rem, 2.8vw, 1.75rem)',
            fontWeight: '300',
            letterSpacing: '0.45em',
            textTransform: 'uppercase',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            margin: 0,
            textShadow: '0 0 40px rgba(0, 229, 255, 0.45)',
          }}
        >
          GIS Project Portal
        </h1>
        <p
          style={{
            color: 'rgba(255, 255, 255, 0.38)',
            fontSize: '0.7rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            marginTop: '0.55rem',
            marginBottom: 0,
          }}
        >
          Hover Landmarks to Explore Projects
        </p>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '1.5rem',
          left: 0,
          right: 0,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <p
          style={{
            color: 'rgba(255, 255, 255, 0.2)',
            fontSize: '0.65rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            margin: 0,
          }}
        >
          Drag to orbit · Scroll to zoom
        </p>
      </div>
    </div>
  )
}
