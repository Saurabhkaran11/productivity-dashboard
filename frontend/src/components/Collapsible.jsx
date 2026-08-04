import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export default function Collapsible({ title, count, defaultOpen = true, children, className = '', icon }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`collapsible ${open ? 'open' : ''} ${className}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {icon && <span style={{ display: 'flex', color: 'var(--accent-soft)' }}>{icon}</span>}
        <span>{title}</span>
        {count !== undefined && <span className="collapsible-count">{count}</span>}
        <span className="collapsible-chevron">
          <ChevronRight size={18} />
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  )
}
