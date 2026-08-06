import React, { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { register, login, getGoogleUrl } from '../utils/api'
import { useAuth } from '../context/AuthContext'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  )
}

export default function Login({ brand }) {
  const { login: authLogin } = useAuth()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMsg('')
    setBusy(true)
    try {
      if (mode === 'register') {
        const res = await register(form)
        authLogin(res.data.token, res.data.user)
      } else {
        const res = await login({ email: form.email, password: form.password })
        authLogin(res.data.token, res.data.user)
      }
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(Array.isArray(detail) ? 'Please fill all fields correctly.' : detail || 'Something went wrong.')
    }
    setBusy(false)
  }

  async function handleGoogle() {
    setError('')
    setMsg('')
    setBusy(true)
    try {
      const res = await getGoogleUrl()
      // Keep OAuth in this tab.  Popup flows are often blocked or detached by
      // browser privacy protections, which prevents the completed sign-in from
      // reaching the original dashboard tab.
      window.location.assign(res.data.url)
      return
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'Google login is not set up yet. Create a free Google Cloud OAuth client and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env, then restart the backend. Instructions are in the README.'
      )
    }
    setBusy(false)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {brand}
        <h1 className="login-title">Welcome to MyLife</h1>
        <p className="login-sub">Track spending, work, schedule &amp; tasks in one place</p>

        <div className="login-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setMsg('') }}>
            Sign In
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setMsg('') }}>
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your name"
                required
              />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={mode === 'register' ? 'At least 6 characters' : 'Your password'}
              required
              minLength={6}
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          {msg && <p className="login-msg">{msg}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="login-divider"><span>or continue with</span></div>

        <button className="btn btn-google btn-block" onClick={handleGoogle} disabled={busy}>
          <GoogleIcon /> Continue with Google
        </button>

        <div className="login-foot">
          <BarChart3 size={14} /> Your data stays on this device · Local SQLite storage
        </div>
      </div>
    </div>
  )
}
