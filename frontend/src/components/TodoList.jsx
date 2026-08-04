import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { getTodos, addTodo, updateTodo, deleteTodo } from '../utils/api'
import Collapsible from './Collapsible'

const PROGRESS_COLORS = ['#4ade80', '#f87171']
const PRIORITY_COLORS = { high: '#f87171', medium: '#fbbf24', low: '#4ade80' }

export default function TodoList() {
  const [todos, setTodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const res = await getTodos()
      setTodos(res.data)
    } catch (err) {
      console.error('Failed to load todos:', err)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title) return
    try {
      await addTodo({
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        due_date: form.due_date || null,
      })
      setForm({ title: '', description: '', priority: 'medium', due_date: '' })
      loadData()
    } catch (err) {
      console.error('Failed to add todo:', err)
    }
  }

  async function toggleComplete(todo) {
    try {
      await updateTodo(todo.id, { completed: !todo.completed })
      loadData()
    } catch (err) {
      console.error('Failed to update todo:', err)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this todo?')) return
    try {
      await deleteTodo(id)
      loadData()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const pendingCount = todos.filter((t) => !t.completed).length
  const completedCount = todos.filter((t) => t.completed).length
  const highCount = todos.filter((t) => !t.completed && t.priority === 'high').length

  const progressData = [
    { name: 'Completed', value: completedCount },
    { name: 'Pending', value: pendingCount },
  ]

  const priorityData = ['high', 'medium', 'low'].map((p) => ({
    name: p.charAt(0).toUpperCase() + p.slice(1),
    value: todos.filter((t) => t.priority === p).length,
  })).filter((d) => d.value > 0)

  const completionPct = todos.length > 0
    ? Math.round((completedCount / todos.length) * 100)
    : 0

  return (
    <div>
      <h1 className="page-title">To-Do List</h1>

      <div className="card-grid">
        <div className="card">
          <h3>Pending</h3>
          <div className="value yellow">{pendingCount}</div>
        </div>
        <div className="card">
          <h3>Completed</h3>
          <div className="value green">{completedCount}</div>
        </div>
        <div className="card">
          <h3>High Priority</h3>
          <div className="value red">{highCount}</div>
        </div>
        <div className="card">
          <h3>Total</h3>
          <div className="value blue">{todos.length}</div>
        </div>
      </div>

      <Collapsible title="Charts & Analytics" count="3 charts">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Completion Progress</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={progressData}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                innerRadius={60}
                outerRadius={95}
                label={(e) => `${e.name}: ${e.value}`}
              >
                {progressData.map((_, i) => <Cell key={i} fill={PROGRESS_COLORS[i % PROGRESS_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 8, fontSize: 14 }}>
            {completionPct}% of tasks complete
          </p>
        </div>

        <div className="chart-card">
          <h3>Tasks by Priority</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={priorityData}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                outerRadius={95}
                label={(e) => `${e.name}: ${e.value}`}
              >
                {priorityData.map((entry) => (
                  <Cell key={entry.name} fill={PRIORITY_COLORS[entry.name.toLowerCase()]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Priority vs Completion</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={['high', 'medium', 'low'].map((p) => ({
              name: p.charAt(0).toUpperCase() + p.slice(1),
              Total: todos.filter((t) => t.priority === p).length,
              Completed: todos.filter((t) => t.priority === p && t.completed).length,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Legend />
              <Bar dataKey="Total" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completed" fill="#4ade80" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        </div>
      </Collapsible>

      <div className="form-card">
        <h3>Add To-Do</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="Finish project report"
              />
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-group">
              <label>Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
          <div className="form-group" style={{ marginTop: 8 }}>
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional details..."
            />
          </div>
        </form>
      </div>

      <div className="form-card">
        <h3>Tasks</h3>
        {loading ? <p>Loading...</p> : (
          <div>
            {todos.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No todos yet. Add your first task above.</p>
            ) : todos.map((todo) => (
              <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={todo.completed}
                  onChange={() => toggleComplete(todo)}
                />
                <div className="todo-title">{todo.title}</div>
                {todo.due_date && <span className="todo-due">Due: {todo.due_date}</span>}
                <span className={`todo-badge badge-${todo.priority}`}>{todo.priority}</span>
                <button className="btn btn-danger" onClick={() => handleDelete(todo.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
