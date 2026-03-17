import React, { useState, useRef } from 'react'

interface Props {
  label: string
  children: React.ReactElement
  side?: 'top' | 'bottom'
}

export function Tooltip({ label, children, side = 'bottom' }: Props): JSX.Element {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), 400)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute',
          [side === 'bottom' ? 'top' : 'bottom']: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: side === 'bottom' ? 5 : undefined,
          marginBottom: side === 'top' ? 5 : undefined,
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 4,
          padding: '3px 7px',
          fontSize: 11,
          color: '#ccc',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 99999,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {label}
        </div>
      )}
    </div>
  )
}
