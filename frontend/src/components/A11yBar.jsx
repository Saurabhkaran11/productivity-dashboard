import React from 'react'
import {
  Type, Contrast, MousePointerClick,
  Volume2, Mic, MicOff, HelpCircle, Check, Pause,
} from 'lucide-react'
import { useUISettings } from '../context/SettingsContext'

const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.45]

export default function A11yBar({
  speak, listening, toggleListening, voiceSupported, onOpenHelp, onAnnounce,
}) {
  const { settings, update } = useUISettings()

  const bumpFont = (dir) => {
    const idx = FONT_STEPS.indexOf(settings.fontSize)
    const next = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, idx + dir))]
    update({ fontSize: next })
    if (speak) speak(dir > 0 ? 'Text size increased' : 'Text size decreased')
  }

  const toggle = (key, onLabel, offLabel) => {
    const next = !settings[key]
    update({ [key]: next })
    if (speak) speak(next ? onLabel : offLabel)
  }

  const BarButton = ({ onClick, title, active, children }) => (
    <button
      type="button"
      className={`a11y-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={!!active}
    >
      {children}
    </button>
  )

  return (
    <div className="a11y-bar" role="toolbar" aria-label="Accessibility controls">
      <BarButton title="Make text bigger (A+)" onClick={() => bumpFont(1)}>
        <span className="a11y-font-icon">A<span className="a11y-plus">+</span></span>
      </BarButton>
      <BarButton title="Reset text size" onClick={() => { update({ fontSize: 1 }); if (speak) speak('Text size reset') }}>
        <span className="a11y-font-icon">A<Check size={12} /></span>
      </BarButton>
      <BarButton title="Make text smaller (A-)" onClick={() => bumpFont(-1)}>
        <span className="a11y-font-icon">A<span className="a11y-minus">-</span></span>
      </BarButton>

      <span className="a11y-divider" />

      <BarButton
        title="High contrast mode"
        active={settings.highContrast}
        onClick={() => toggle('highContrast', 'High contrast mode on', 'High contrast mode off')}
      >
        <Contrast size={18} />
      </BarButton>
      <BarButton
        title="Dyslexia-friendly font"
        active={settings.dyslexiaFont}
        onClick={() => toggle('dyslexiaFont', 'Dyslexia friendly font on', 'Dyslexia friendly font off')}
      >
        <Type size={18} />
      </BarButton>
      <BarButton
        title="Big easy-to-press buttons"
        active={settings.bigButtons}
        onClick={() => toggle('bigButtons', 'Big buttons on', 'Big buttons off')}
      >
        <MousePointerClick size={18} />
      </BarButton>
      <BarButton
        title="Reduce movement and 3D effects"
        active={settings.reduceMotion}
        onClick={() => toggle('reduceMotion', 'Reduced movement on', 'Reduced movement off')}
      >
        <Pause size={18} />
      </BarButton>

      <span className="a11y-divider" />

      <BarButton title="Read this page aloud" onClick={() => onAnnounce?.()}>
        <Volume2 size={18} />
      </BarButton>
      {voiceSupported && (
        <BarButton
          title={listening ? 'Listening — say a page name to navigate' : 'Voice navigation (say a page name)'}
          active={listening}
          onClick={toggleListening}
        >
          {listening ? <Mic size={18} /> : <MicOff size={18} />}
        </BarButton>
      )}

      <BarButton title="Help — how to use this app" onClick={onOpenHelp}>
        <HelpCircle size={18} />
      </BarButton>
    </div>
  )
}
