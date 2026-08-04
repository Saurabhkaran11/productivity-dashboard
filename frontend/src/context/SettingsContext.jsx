import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

const SettingsContext = createContext(null)

const STORAGE_KEY = 'pd_ui_settings'

export const THEMES = {
  midnight: 'Midnight',
  ocean: 'Ocean',
  sunset: 'Sunset',
  forest: 'Forest',
  lavender: 'Lavender',
  candy: 'Candy',
  light: 'Light',
}

const DEFAULTS = {
  theme: 'midnight',
  fontSize: 1,          // 0.85 / 1 / 1.15 / 1.3
  highContrast: false,
  dyslexiaFont: false,
  bigButtons: false,
  reduceMotion: false,
  voice: false,
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings)

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // Apply CSS-level preferences to <html>
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-scale', settings.fontSize)
    root.setAttribute('data-theme', THEMES[settings.theme] ? settings.theme : 'midnight')
    root.classList.toggle('high-contrast', settings.highContrast)
    root.classList.toggle('dyslexia-font', settings.dyslexiaFont)
    root.classList.toggle('big-buttons', settings.bigButtons)
    root.classList.toggle('reduce-motion', settings.reduceMotion)
  }, [settings])

  const value = { settings, update }
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useUISettings() {
  return useContext(SettingsContext)
}
