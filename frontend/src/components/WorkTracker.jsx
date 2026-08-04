import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell
} from 'recharts'
import { getWorkLog, addWorkLog, deleteWorkLog } from '../utils/api'
import Collapsible from './Collapsible'

const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#a78bfa', '#f87171', '#22d3ee']

export default function WorkTracker() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    task: '',
    project: '',
    hours: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const res = await getWorkLog()
      setLogs(res.data)
    } catch (err) {
      console.error('Failed to load work log:', err)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.task || !form.hours || !form.date) return
    try {
      await addWorkLog({
        task: form.task,
        project: form.project || null,
        hours: parseFloat(form.hours),
        date: form.date,
        notes: form.notes || null,
      })
      setForm({ ...form, task: '', project: '', hours: '', notes: '' })
      loadData()
    } catch (err) {
      console.error('Failed to add work log:', err)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this work entry?')) return
    try {
      await deleteWorkLog(id)
      loadData()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const totalHours = logs.reduce((s, l) => s + l.hours, 0)

  const hoursByDate = logs
    .reduce((acc, l) => {
      const existing = acc.find((a) => a.date === l.date)
      if (existing) existing.hours += l.hours
      else acc.push({ date: l.date, hours: l.hours })
      return acc
    }, [])
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const hoursByProject = Object.entries(
    logs.reduce((acc, l) => {
      const key = l.project || 'No Project'
      acc[key] = (acc[key] || 0) + l.hours
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  return (
    <div>
      <h1 className="page-title">Work Tracker</h1>

      <div className="card-grid">
        <div className="card">
          <h3>Total Hours</h3>
          <div className="value blue">{totalHours.toFixed(1)}h</div>
        </div>
        <div className="card">
          <h3>Entries</h3>
          <div className="value">{logs.length}</div>
        </div>
        <div className="card">
          <h3>Projects</h3>
          <div className="value yellow">{hoursByProject.length}</div>
        </div>
      </div>

      <div className="form-card">
        <h3>Log Work</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Task</label>
              <input
                type="text"
                value={form.task}
                onChange={(e) => setForm({ ...form, task: e.target.value })}
                required
                placeholder="Worked on AI feature"
              />
            </div>
            <div className="form-group">
              <label>Project</label>
              <input
                type="text"
                value={form.project}
                onChange={(e) => setForm({ ...form, project: e.target.value })}
                placeholder="AI Projects"
              />
            </div>
            <div className="form-group">
              <label>Hours</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="24"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
                required
                placeholder="2.5"
              />
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Log</button>
          </div>
          <div className="form-group" style={{ marginTop: 8 }}>
            <label>Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="What did you accomplish?"
            />
          </div>
        </form>
      </div>

      <Collapsible title="Charts & Analytics" count="3 charts">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Hours by Date</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hoursByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Bar dataKey="hours" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Hours by Project</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={hoursByProject}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                outerRadius={100}
                label={(e) => e.name}
              >
                {hoursByProject.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${v.toFixed(1)}h`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Hours Trend (Line)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hoursByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Line type="monotone" dataKey="hours" stroke="#4ade80" strokeWidth={2} dot={{ fill: '#4ade80' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        </div>
      </Collapsible>

      <div className="form-card">
        <h3>Work Logs</h3>
        {loading ? <p>Loading...</p> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Task</th>
                <th>Project</th>
                <th>Hours</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8' }}>No work logged yet.</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.date}</td>
                  <td>{l.task}</td>
                  <td>{l.project || '-'}</td>
                  <td style={{ color: '#38bdf8', fontWeight: 600 }}>{l.hours.toFixed(1)}h</td>
                  <td>{l.notes || '-'}</td>
                  <td><button className="btn btn-danger" onClick={() => handleDelete(l.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
