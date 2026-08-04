import React, { useCallback, useRef } from 'react'
import { useUISettings } from '../context/SettingsContext'

// Gentle 3D tilt-on-hover wrapper. Respects reduced-motion and touch input.
export default function Card3D({ children, className = '', tilt = 6, scale = 1.02 }) {
  const ref = useRef(null)
  const { settings } = useUISettings() || { settings: {} }
  const reduced = !!settings.reduceMotion

  const onMove = useCallback((e) => {
    const el = ref.current
    if (!el || reduced) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const rx = (0.5 - py) * tilt
    const ry = (px - 0.5) * tilt
    el.style.setProperty('--rx', `${rx.toFixed(2)}deg`)
    el.style.setProperty('--ry', `${ry.toFixed(2)}deg`)
    el.style.setProperty('--s', `${scale.toFixed(3)}`)
  }, [reduced, tilt, scale])

  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--s', '1')
  }, [])

  return (
    <div
      ref={ref}
      className={`card-3d ${className}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  )
}
