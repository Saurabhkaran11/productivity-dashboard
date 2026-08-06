import React, { useMemo, useRef, useState, Component, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useUISettings } from '../../context/SettingsContext'

const SHAPES = [
  { type: 'icosa', color: '#0ea5e9', size: 0.7, pos: [-4.2, 1.6, -3], speed: 0.35 },
  { type: 'torus', color: '#6366f1', size: 0.55, pos: [4.6, -1.4, -2], speed: 0.28 },
  { type: 'sphere', color: '#22c55e', size: 0.5, pos: [-3.4, -2.2, -1], speed: 0.22 },
  { type: 'octa', color: '#f59e0b', size: 0.6, pos: [3.6, 2.0, -3.5], speed: 0.3 },
  { type: 'torus', color: '#ec4899', size: 0.42, pos: [0.0, 2.6, -4], speed: 0.26 },
  { type: 'sphere', color: '#38bdf8', size: 0.35, pos: [5.4, 2.4, -5], speed: 0.2 },
]

// Quick WebGL capability probe so the scene is skipped on devices/GPU-less
// environments where a 3D context cannot be created (or crashes).
function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

// Hard kill-switch: localStorage "pd_disable_3d" = "1" turns the scene off.
function sceneEnabled() {
  try {
    return localStorage.getItem('pd_disable_3d') !== '1'
  } catch {
    return true
  }
}

function Geometry({ shape, color, size, pos, speed, reduced }) {
  const ref = useRef()
  const baseY = pos[1]
  const phase = pos[0] + pos[2]

  useFrame((state, delta) => {
    if (!ref.current || reduced) return
    ref.current.rotation.x += delta * speed
    ref.current.rotation.y += delta * speed * 1.4
    ref.current.position.y = baseY + Math.sin(state.clock.elapsedTime * speed * 2 + phase) * 0.16
  })

  let geo = null
  if (shape === 'icosa') geo = <icosahedronGeometry args={[size, 0]} />
  else if (shape === 'torus') geo = <torusGeometry args={[size, size * 0.38, 12, 32]} />
  else if (shape === 'octa') geo = <octahedronGeometry args={[size, 0]} />
  else geo = <sphereGeometry args={[size, 20, 20]} />

  return (
    <mesh ref={ref} position={pos}>
      {geo}
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.25}
        roughness={0.35}
        metalness={0.1}
        transparent
        opacity={reduced ? 0.5 : 0.85}
      />
    </mesh>
  )
}

// If the Canvas throws (e.g. context creation fails), render nothing instead
// of breaking the whole app.
class SceneErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    console.warn('3D scene disabled:', err?.message)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function SceneInner({ reduced, shapes }) {
  return (
    <Canvas
      dpr={reduced ? 1 : [1, 1.5]}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ alpha: true, antialias: !reduced, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 6], fov: 60 }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={0.9} />
        <pointLight position={[-5, -3, -2]} intensity={0.5} color="#6366f1" />
        {shapes.map((s, i) => (
          <Geometry key={i} {...s} reduced={reduced} />
        ))}
      </Suspense>
    </Canvas>
  )
}

export default function Scene3D() {
  const { settings } = useUISettings() || { settings: {} }
  const reduced = !!settings.reduceMotion
  const [webgl] = useState(() => supportsWebGL() && sceneEnabled())
  const shapes = useMemo(
    () => (reduced ? SHAPES.slice(0, 2) : SHAPES),
    [reduced],
  )

  if (!webgl) return null

  return (
    <div className="scene3d" aria-hidden="true">
      <SceneErrorBoundary>
        <SceneInner reduced={reduced} shapes={shapes} />
      </SceneErrorBoundary>
    </div>
  )
}
