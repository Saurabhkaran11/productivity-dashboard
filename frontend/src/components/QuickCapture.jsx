import React, { useEffect, useRef, useState } from 'react'
import { Command, CornerDownLeft, Undo2 } from 'lucide-react'
import {
  addSchedule, addSpending, addTodo, addWorkLog,
  deleteSchedule, deleteSpending, deleteTodo, deleteWorkLog,
} from '../utils/api'
import {
  classifyQuickCapture, parseQuickSchedule, parseQuickSpending, parseQuickTodo, parseQuickWork,
} from '../utils/quickCapture'

const actionConfig = {
  spending: { create: addSpending, remove: deleteSpending, parse: parseQuickSpending, label: 'Expense saved' },
  todo: { create: addTodo, remove: deleteTodo, parse: parseQuickTodo, label: 'Task saved' },
  work: { create: addWorkLog, remove: deleteWorkLog, parse: parseQuickWork, label: 'Work log saved' },
  schedule: { create: addSchedule, remove: deleteSchedule, parse: parseQuickSchedule, label: 'Event saved' },
}

function canFocusCapture(target) {
  const tag = target?.tagName?.toLowerCase()
  return !['input', 'textarea', 'select', 'button'].includes(tag) && !target?.isContentEditable
}

export default function QuickCapture({ onCreated }) {
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [lastAction, setLastAction] = useState(null)

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!canFocusCapture(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/' || event.key.toLowerCase() === 'c') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const text = value.trim()
    if (!text || busy) return

    setBusy(true)
    setNotice('')
    setLastAction(null)
    try {
      const type = classifyQuickCapture(text)
      const config = actionConfig[type]
      const response = await config.create(config.parse(text))
      setValue('')
      setNotice(config.label)
      setLastAction({ type, id: response.data.id })
      onCreated?.()
    } catch (error) {
      setNotice(error?.message || error?.response?.data?.detail || 'Could not understand that entry yet.')
    }
    setBusy(false)
  }

  async function undo() {
    if (!lastAction) return
    try {
      await actionConfig[lastAction.type].remove(lastAction.id)
      setNotice('Undone')
      setLastAction(null)
      onCreated?.()
    } catch {
      setNotice('Could not undo that entry.')
    }
  }

  return (
    <div className="quick-capture-wrap">
      <form className="quick-capture" onSubmit={handleSubmit} aria-label="Quick capture">
        <span className="quick-capture-icon" aria-hidden="true"><Command size={17} /></span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Log it fast — $24 lunch, task Review report tomorrow, 1.5h design review…"
          aria-label="Quick capture: log spending, tasks, work, or events"
          disabled={busy}
        />
        <span className="quick-capture-key" aria-hidden="true"><CornerDownLeft size={13} /> Enter</span>
      </form>
      <div className="quick-capture-feedback" aria-live="polite">
        <span>{notice}</span>
        {lastAction && <button type="button" onClick={undo}><Undo2 size={13} /> Undo</button>}
      </div>
    </div>
  )
}
