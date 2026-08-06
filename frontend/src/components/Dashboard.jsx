import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts'
import {
  ArrowUpRight, CalendarClock, CheckCircle2, CircleDollarSign,
  Clock3, ListChecks, Timer, WalletCards,
} from 'lucide-react'
import { getSpending, getWorkLog, getSummary } from '../utils/api'
import Collapsible from './Collapsible'

const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#e879f9']

function MetricCard({ label, value, detail, tone, icon: Icon }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-icon"><Icon size={19} /></div>
      <div className="metric-copy">
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      <ArrowUpRight className="metric-arrow" size={18} aria-hidden="true" />
    </article>
  )
}

export default function Dashboard({ refreshKey = 0 }) {
  const [summary, setSummary] = useState(null)
  const [spending, setSpending] = useState([])
  const [workLog, setWorkLog] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [refreshKey])

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
  const todaySchedule = summary.today_schedule || []
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
  const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="dashboard-view">
      <section className="dashboard-hero">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="live-dot" /> {greeting}</span>
          <h1>Make today <em>count.</em></h1>
          <p>One clear view of your money, focus time, and priorities—designed to keep momentum effortless.</p>
          <div className="hero-meta">
            <span><CalendarClock size={15} /> {todaySchedule.length} events today</span>
            <span><CheckCircle2 size={15} /> {completedPct}% complete</span>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring orbit-ring-one" />
          <div className="orbit-ring orbit-ring-two" />
          <div className="orbit-satellite orbit-satellite-one" />
          <div className="orbit-satellite orbit-satellite-two" />
          <div className="orbit-core"><span>{completedPct}%</span><small>on track</small></div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Today's key metrics">
        <MetricCard label="Today's spending" value={currency.format(summary.today_spending)} detail="Tracked today" tone="rose" icon={CircleDollarSign} />
        <MetricCard label="Focus time" value={`${summary.today_work_hours}h`} detail="Logged today" tone="sky" icon={Timer} />
        <MetricCard label="Tasks remaining" value={number.format(summary.pending_todos)} detail={`${summary.completed_todos} completed`} tone="amber" icon={ListChecks} />
        <MetricCard label="Total spending" value={currency.format(summary.total_spending)} detail="All-time record" tone="violet" icon={WalletCards} />
      </section>

      <section className="dashboard-split">
        <div className="agenda-panel">
          <div className="panel-heading">
            <div>
              <span>Timeline</span>
              <h2>Today’s agenda</h2>
            </div>
            <CalendarClock size={20} aria-hidden="true" />
          </div>
          {todaySchedule.length === 0 ? (
            <div className="agenda-empty">
              <CalendarClock size={22} />
              <p>Your calendar is clear. Use the breathing room for something that matters.</p>
            </div>
          ) : (
            <div className="agenda-list">
              {todaySchedule.map((ev) => (
                <div className="agenda-item" key={ev.id}>
                  <div className="agenda-time">{ev.start_time}<span>{ev.end_time}</span></div>
                  <div className="agenda-line" />
                  <div className="agenda-details">
                    <strong>{ev.title}</strong>
                    {ev.notes && <span>{ev.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="focus-panel">
          <div className="panel-heading">
            <div>
              <span>Momentum</span>
              <h2>Daily balance</h2>
            </div>
            <Clock3 size={20} aria-hidden="true" />
          </div>
          <div className="radial-progress" style={{ '--progress': `${completedPct * 3.6}deg` }}>
            <div><strong>{completedPct}%</strong><span>tasks done</span></div>
          </div>
          <div className="balance-row"><span>Scheduled time</span><strong>{totalScheduledHours.toFixed(1)}h <small>· {scheduleUtilPct}%</small></strong></div>
          <div className="balance-row"><span>Unscheduled time</span><strong>{Math.max(0, 24 - totalScheduledHours).toFixed(1)}h</strong></div>
        </aside>
      </section>

      <Collapsible title="Insights & analysis" count="7 charts" defaultOpen={false} className="analytics-section">
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
