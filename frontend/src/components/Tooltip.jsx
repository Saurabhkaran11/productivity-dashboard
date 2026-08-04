import React from 'react'

export default function Tooltip({ label, children, side = 'right' }) {
  return (
    <div className="tooltip-wrap" tabIndex="-1">
      {children}
      <span className={`tooltip tooltip-${side}`} role="tooltip">
        {label}
      </span>
    </div>
  )
}
