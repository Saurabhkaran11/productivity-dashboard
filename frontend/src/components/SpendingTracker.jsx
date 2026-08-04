import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { getSpending, addSpending, deleteSpending } from '../utils/api'
import Collapsible from './Collapsible'

const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#e879f9']
const CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Entertainment', 'Bills', 'Health', 'Education', 'Other'
]

const PERIODS = ['daily', 'weekly', 'monthly', 'yearly']

export default function SpendingTracker() {
  const [entries, setEntries] = useState([])
  const [period, setPeriod] = useState('daily')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    amount: '',
    category: 'Food',
    description: '',
    date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    loadData()
  }, [period])

  async function loadData() {
    setLoading(true)
    try {
      const res = await getSpending(period)
      setEntries(res.data)
    } catch (err) {
      console.error('Failed to load spending:', err)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || !form.date) return
    try {
      await addSpending({
        amount: parseFloat(form.amount),
        category: form.category,
        description: form.description || null,
        date: form.date,
      })
      setForm({ ...form, amount: '', description: '' })
      loadData()
    } catch (err) {
      console.error('Failed to add spending:', err)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this spending entry?')) return
    try {
      await deleteSpending(id)
      loadData()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const total = entries.reduce((sum, e) => sum + e.amount, 0)
  const byCategory = Object.entries(
    entries.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  const byDate = entries
    .reduce((acc, e) => {
      const existing = acc.find((a) => a.date === e.date)
      if (existing) existing.amount += e.amount
      else acc.push({ date: e.date, amount: e.amount })
      return acc
    }, [])
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return (
    <div>
      <h1 className="page-title">Spending Tracker</h1>

      <div className="period-filter">
        {PERIODS.map((p) => (
          <button
            key={p}
            className={`period-btn ${period === p ? 'active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <div className="card-grid">
        <div className="card">
          <h3>Total ({period})</h3>
          <div className="value red">${total.toFixed(2)}</div>
        </div>
        <div className="card">
          <h3>Entries</h3>
          <div className="value blue">{entries.length}</div>
        </div>
        <div className="card">
          <h3>Categories</h3>
          <div className="value yellow">{byCategory.length}</div>
        </div>
      </div>

      <div className="form-card">
        <h3>Add Spending</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                placeholder="25.00"
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
              <label>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Lunch at cafe"
              />
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
        </form>
      </div>

      <Collapsible title="Charts & Analytics" count="4 charts">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>By Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={byCategory}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                outerRadius={100}
                label={(e) => e.name}
              >
                {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>By Date</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={byDate}>
              <defs>
                <linearGradient id="spendGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Area type="monotone" dataKey="amount" stroke="#f87171" fill="url(#spendGrad2)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Category Comparison (Bar)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Bar dataKey="value" fill="#fbbf24" radius={[4, 4, 0, 0]}>
                {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Daily Trend (Line)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={byDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip formatter={(v) => `$${v.toFixed(2)}`} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Line type="monotone" dataKey="amount" stroke="#38bdf8" strokeWidth={2} dot={{ fill: '#38bdf8' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        </div>
      </Collapsible>

      <div className="form-card">
        <h3>Entries ({period})</h3>
        {loading ? <p>Loading...</p> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8' }}>No entries for this period.</td></tr>
              ) : entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.category}</td>
                  <td>{e.description || '-'}</td>
                  <td style={{ color: '#f87171', fontWeight: 600 }}>${e.amount.toFixed(2)}</td>
                  <td><button className="btn btn-danger" onClick={() => handleDelete(e.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
