import React, { useState } from 'react'
import { exportExcel, exportPdf } from '../utils/api'
import { downloadBlob } from '../utils/download'

export default function ExportSection() {
  const [dataType, setDataType] = useState('all')
  const [period, setPeriod] = useState('all')
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')

  const periods = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'all', label: 'All Time' },
  ]

  const dataTypes = [
    { value: 'all', label: 'All Data' },
    { value: 'spending', label: 'Spending' },
    { value: 'worklog', label: 'Work Log' },
    { value: 'todos', label: 'To-Do List' },
    { value: 'schedule', label: 'Schedule' },
  ]

  async function handleExport(format) {
    setExporting(true)
    setMessage('')
    try {
      const suffix = `${dataType}_${period}`
      if (format === 'excel') {
        const res = await exportExcel(dataType, period)
        downloadBlob(res.data, `productivity_${suffix}.xlsx`)
      } else {
        const res = await exportPdf(dataType, period)
        downloadBlob(res.data, `productivity_${suffix}.pdf`)
      }
      setMessage(`${format.toUpperCase()} export complete!`)
    } catch (err) {
      console.error('Export failed:', err)
      setMessage('Export failed. Check backend is running.')
    }
    setExporting(false)
  }

  return (
    <div>
      <h1 className="page-title">Export & Reports</h1>

      <div className="form-card">
        <h3>Generate Report</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Data Type</label>
            <select value={dataType} onChange={(e) => setDataType(e.target.value)}>
              {dataTypes.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <button
            className="btn btn-success"
            onClick={() => handleExport('excel')}
            disabled={exporting}
          >
            {exporting ? 'Generating...' : 'Export Excel (.xlsx)'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
          >
            {exporting ? 'Generating...' : 'Export PDF (.pdf)'}
          </button>
        </div>
        {message && <p style={{ color: '#4ade80', marginTop: 12 }}>{message}</p>}
      </div>

      <div className="form-card">
        <h3>What's Included Per Report</h3>
        <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8 }}>
          <p><strong style={{ color: '#e2e8f0' }}>Spending:</strong> Date, category, amount, and description of every expense in the selected period.</p>
          <p><strong style={{ color: '#e2e8f0' }}>Work Log:</strong> Date, task, project, hours worked, and notes.</p>
          <p><strong style={{ color: '#e2e8f0' }}>To-Do List:</strong> All tasks with priority, completion status, and due dates.</p>
          <p><strong style={{ color: '#e2e8f0' }}>Schedule:</strong> All events with date, start/end times, and recurrence flags.</p>
        </div>
      </div>
    </div>
  )
}
