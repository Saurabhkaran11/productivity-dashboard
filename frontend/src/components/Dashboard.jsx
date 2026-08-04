import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts'
import { getSpending, getWorkLog, getSummary } from '../utils/api'
import Collapsible from './Collapsible'

const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#e879f9']

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [spending, setSpending] = useState([])
  const [workLog, setWorkLog] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [sumRes, spendRes, workRes] = await Promise.all([
        getSummary(), getSpending('monthly'), getWorkLog(),
      ])
      setSummary(sumRes.data)
      setSpending(spendRes.data)
      setWorkLog(workRes.data)
    } catch (err) {
      console.error('Failed to load dashboard:', err)
    }
    setLoading(false)
  }

  const spendingByCategory = Object.entries(
    spending.reduce((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + s.amount
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  const spendingByDate = spending
    .reduce((acc, s) => {
      const existing = acc.find((a) => a.date === s.date)
      if (existing) existing.amount += s.amount
      else acc.push({ date: s.date, amount: s.amount })
      return acc
    }, [])
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const hoursByDate = workLog
    .reduce((acc, w) => {
      const existing = acc.find((a) => a.date === w.date)
      if (existing) existing.hours += w.hours
      else acc.push({ date: w.date, hours: w.hours })
      return acc
    }, [])
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  if (loading) return <div className="page-title">Loading...</div>

  const completedPct = summary.completed_todos + summary.pending_todos > 0
    ? Math.round((summary.completed_todos / (summary.completed_todos + summary.pending_todos)) * 100)
    : 0

  const todoProgressData = [
    { name: 'Completed', value: summary.completed_todos },
    { name: 'Pending', value: summary.pending_todos },
  ]

  const hoursBetween = (start, end) => {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    const mins = (eh * 60 + em) - (sh * 60 + sm)
    return mins > 0 ? mins / 60 : 0
  }

  const scheduleUtilData = summary.today_schedule
    .map((ev) => ({ name: ev.title, hours: hoursBetween(ev.start_time, ev.end_time) }))
    .filter((d) => d.hours > 0)
    .reduce((acc, d) => {
      const existing = acc.find((a) => a.name === d.name)
      if (existing) existing.hours += d.hours
      else acc.push(d)
      return acc
    }, [])

  const totalScheduledHours = scheduleUtilData.reduce((sum, d) => sum + d.hours, 0)
  const scheduleUtilPct = Math.min(Math.round((totalScheduledHours / 24) * 100), 100)

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      <div className="card-grid">
        <div className="card">
          <h3>Today's Spending</h3>
          <div className="value red">${summary.today_spending.toFixed(2)}</div>
        </div>
        <div className="card">
          <h3>Total Spending</h3>
          <div className="value">${summary.total_spending.toFixed(2)}</div>
        </div>
        <div className="card">
          <h3>Work Hours Today</h3>
          <div className="value blue">{summary.today_work_hours}h</div>
        </div>
        <div className="card">
          <h3>Pending Todos</h3>
          <div className="value yellow">{summary.pending_todos}</div>
        </div>
        <div className="card">
          <h3>Completed</h3>
          <div className="value green">{summary.completed_todos}</div>
        </div>
        <div className="card">
          <h3>Task Completion</h3>
          <div className="value purple">{completedPct}%</div>
        </div>
      </div>

      <div className="form-card">
        <h3>Today's Schedule</h3>
        {summary.today_schedule.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>No events scheduled for today.</p>
        ) : (
          summary.today_schedule.map((ev) => (
            <div className="schedule-item" key={ev.id}>
              <div className="schedule-time">
                {ev.start_time} - {ev.end_time}
              </div>
              <div className="schedule-details">
                <h4>{ev.title}</h4>
                {ev.notes && <p>{ev.notes}</p>}
              </div>
            </div>
          ))
        )}
      </div>

      <Collapsible title="Charts & Analytics" count="7 charts">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>To-Do Progress</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={todoProgressData}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                innerRadius={60}
                outerRadius={95}
                label={(e) => `${e.name}: ${e.value}`}
              >
                <Cell fill="#4ade80" />
                <Cell fill="#f87171" />
              </Pie>
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 8, fontSize: 14 }}>
            {completedPct}% of all tasks complete
          </p>
        </div>

        <div className="chart-card">
          <h3>Today's Schedule Utilization</h3>
          {scheduleUtilData.length === 0 ? (
            <p style={{ color: '#94a3b8', padding: '40px 0', textAlign: 'center' }}>No events scheduled today.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={scheduleUtilData}
                  dataKey="hours"
                  nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  label={(e) => `${e.name}`}
                >
                  {scheduleUtilData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => `${v.toFixed(1)}h`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
          {scheduleUtilData.length > 0 && (
            <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 8, fontSize: 14 }}>
              {totalScheduledHours.toFixed(1)} hours scheduled ({scheduleUtilPct}% of day)
            </p>
          )}
        </div>

        <div className="chart-card">
          <h3>Spending by Category (Monthly)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={spendingByCategory}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={(entry) => `${entry.name}`}
              >
                {spendingByCategory.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Spending Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={spendingByDate}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Area type="monotone" dataKey="amount" stroke="#f87171" fill="url(#spendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Work Hours Trend</h3>
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
          <h3>Spending by Date (Bar)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={spendingByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Bar dataKey="amount" fill="#fbbf24" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Hours by Date (Line)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hoursByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Line type="monotone" dataKey="hours" stroke="#a78bfa" strokeWidth={2} dot={{ fill: '#a78bfa' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        </div>
      </Collapsible>
    </div>
  )
}
