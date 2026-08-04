import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { getSchedule, addSchedule, deleteSchedule } from '../utils/api'
import Collapsible from './Collapsible'

const UTIL_COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#e879f9']

function hoursBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return mins > 0 ? mins / 60 : 0
}

export default function Schedule() {
  const [schedule, setSchedule] = useState([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    title: '',
    start_time: '09:00',
    end_time: '10:00',
    date: new Date().toISOString().split('T')[0],
    recurring: false,
    notes: '',
  })

  useEffect(() => {
    loadData()
  }, [selectedDate])

  async function loadData() {
    setLoading(true)
    try {
      const res = await getSchedule(selectedDate)
      setSchedule(res.data)
    } catch (err) {
      console.error('Failed to load schedule:', err)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title || !form.start_time || !form.end_time) return
    try {
      await addSchedule({
        title: form.title,
        start_time: form.start_time,
        end_time: form.end_time,
        date: form.date,
        recurring: form.recurring,
        notes: form.notes || null,
      })
      setForm({
        title: '',
        start_time: '09:00',
        end_time: '10:00',
        date: selectedDate,
        recurring: false,
        notes: '',
      })
      setSelectedDate(form.date)
      loadData()
    } catch (err) {
      console.error('Failed to add schedule:', err)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this event?')) return
    try {
      await deleteSchedule(id)
      loadData()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const eventsCount = schedule.length
  const recurringCount = schedule.filter((s) => s.recurring).length

  const utilizationData = schedule
    .map((s) => ({ name: s.title, hours: hoursBetween(s.start_time, s.end_time) }))
    .filter((d) => d.hours > 0)
    .reduce((acc, d) => {
      const existing = acc.find((a) => a.name === d.name)
      if (existing) existing.hours += d.hours
      else acc.push(d)
      return acc
    }, [])

  const totalScheduledHours = utilizationData.reduce((sum, d) => sum + d.hours, 0)
  const utilizationPct = Math.min(Math.round((totalScheduledHours / 24) * 100), 100)

  const utilizationByHour = utilizationData.map((d) => ({ name: d.name, hours: d.hours }))

  return (
    <div>
      <h1 className="page-title">Daily Schedule</h1>

      <div className="card-grid">
        <div className="card">
          <h3>Events for Date</h3>
          <div className="value blue">{eventsCount}</div>
        </div>
        <div className="card">
          <h3>Recurring</h3>
          <div className="value yellow">{recurringCount}</div>
        </div>
        <div className="card">
          <h3>Selected Date</h3>
          <div className="value" style={{ fontSize: 18 }}>{selectedDate}</div>
        </div>
      </div>

      <Collapsible title="Charts & Analytics" count="2 charts">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Time Utilization by Activity</h3>
          {utilizationData.length === 0 ? (
            <p style={{ color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>No scheduled events for this date.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={utilizationData}
                  dataKey="hours"
                  nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  label={(e) => `${e.name}`}
                >
                  {utilizationData.map((_, i) => <Cell key={i} fill={UTIL_COLORS[i % UTIL_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => `${v.toFixed(1)}h`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
          {utilizationData.length > 0 && (
            <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 8, fontSize: 14 }}>
              {totalScheduledHours.toFixed(1)} hours scheduled ({utilizationPct}% of the day)
            </p>
          )}
        </div>

        <div className="chart-card">
          <h3>Hours per Activity</h3>
          {utilizationByHour.length === 0 ? (
            <p style={{ color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={utilizationByHour} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={120} />
                <Tooltip formatter={(v) => `${v.toFixed(1)}h`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                  {utilizationByHour.map((_, i) => <Cell key={i} fill={UTIL_COLORS[i % UTIL_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        </div>
      </Collapsible>

      <div className="form-card">
        <h3>Add Event</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="Team standup"
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
            <div className="form-group">
              <label>Start</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>End</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Recurring</label>
              <select
                value={form.recurring}
                onChange={(e) => setForm({ ...form, recurring: e.target.value === 'true' })}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
          <div className="form-group" style={{ marginTop: 8 }}>
            <label>Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes..."
            />
          </div>
        </form>
      </div>

      <div className="form-card">
        <h3>Schedule for {selectedDate}</h3>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ maxWidth: 220 }}>
            <label>Select Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>
        {loading ? <p>Loading...</p> : (
          <div>
            {schedule.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No events on this date.</p>
            ) : schedule.map((ev) => (
              <div className="schedule-item" key={ev.id}>
                <div className="schedule-time">
                  {ev.start_time} - {ev.end_time}
                </div>
                <div className="schedule-details">
                  <h4>{ev.title} {ev.recurring ? ' (recurring)' : ''}</h4>
                  {ev.notes && <p>{ev.notes}</p>}
                </div>
                <button className="btn btn-danger" onClick={() => handleDelete(ev.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
