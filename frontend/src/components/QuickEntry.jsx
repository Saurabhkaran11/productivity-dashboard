import React, { useState } from 'react'
import { CornerDownLeft, Sparkles } from 'lucide-react'

export default function QuickEntry({ label, placeholder, hint, onSubmit }) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    setStatus('')
    setIsError(false)
    try {
      const message = await onSubmit(value.trim())
      setValue('')
      setStatus(message || 'Saved')
    } catch (error) {
      setStatus(error?.message || 'Could not save that entry. Please try again.')
      setIsError(true)
    }
    setBusy(false)
  }

  return (
    <div className="quick-entry-wrap">
      <form className="quick-entry" onSubmit={handleSubmit} aria-label={label}>
        <span className="quick-entry-icon" aria-hidden="true"><Sparkles size={17} /></span>
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          disabled={busy}
        />
        <span className="quick-entry-enter" aria-hidden="true"><CornerDownLeft size={14} /> Enter</span>
      </form>
      <div className="quick-entry-footer">
        <span>{hint}</span>
        <span className={isError ? 'quick-entry-error' : 'quick-entry-status'} aria-live="polite">{status}</span>
      </div>
    </div>
  )
}
