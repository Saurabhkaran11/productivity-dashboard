import React, { useState, useEffect } from 'react'
import {
  User, LogOut, Cloud, Table2, HardDrive, Mail, Send,
  CheckCircle2, RefreshCw, Loader2, AlarmClock, Eye,
  Contrast, Type, MousePointerClick, Pause, Volume2, Palette,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useUISettings, THEMES } from '../context/SettingsContext'
import {
  getSyncStatus, syncSheets, syncDrive,
  sendReportEmail, sendTestEmail, getEmailSettings, saveEmailSettings,
} from '../utils/api'

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const { settings, update } = useUISettings()
  const [syncStatus, setSyncStatus] = useState(null)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const [sheetsPeriod, setSheetsPeriod] = useState('monthly')
  const [drivePeriod, setDrivePeriod] = useState('monthly')
  const [reportPeriod, setReportPeriod] = useState('daily')

  const [emailCfg, setEmailCfg] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '',
    daily_report: 0, report_time: '18:00',
  })

  useEffect(() => {
    loadStatus()
    loadEmailSettings()
  }, [])

  async function loadStatus() {
    try {
      const res = await getSyncStatus()
      setSyncStatus(res.data)
    } catch (e) { /* ignore */ }
  }

  async function loadEmailSettings() {
    try {
      const res = await getEmailSettings()
      setEmailCfg((c) => ({ ...c, ...res.data }))
    } catch (e) { /* ignore */ }
  }

  function flash(message) {
    setResult(message)
    setError('')
    setTimeout(() => setResult(null), 6000)
  }

  async function handleSync(kind) {
    setBusy(kind)
    setError('')
    setResult(null)
    try {
      if (kind === 'sheets') {
        const res = await syncSheets('all', sheetsPeriod)
        flash(`Synced to Google Sheets: ${res.data.spreadsheet_title}`)
      } else {
        const res = await syncDrive(drivePeriod)
        flash(`Backed up to Google Drive (Excel + PDF).`)
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Sync failed. Make sure Google is connected.')
    }
    setBusy('')
    loadStatus()
  }

  async function handleSendReport() {
    setBusy('report')
    setError('')
    setResult(null)
    try {
      const res = await sendReportEmail(reportPeriod)
      flash(`Report sent to ${res.data.sent_to}`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not send email.')
    }
    setBusy('')
  }

  async function handleTestEmail() {
    setBusy('test')
    setError('')
    setResult(null)
    try {
      const res = await sendTestEmail()
      flash(`Test email sent to ${res.data.sent_to}`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not send email.')
    }
    setBusy('')
  }

  async function handleSaveEmail() {
    setBusy('save')
    setError('')
    try {
      await saveEmailSettings({
        smtp_host: emailCfg.smtp_host,
        smtp_port: Number(emailCfg.smtp_port) || 587,
        smtp_user: emailCfg.smtp_user,
        smtp_password: emailCfg.smtp_password,
        daily_report: emailCfg.daily_report ? 1 : 0,
        report_time: emailCfg.report_time,
      })
      flash('Email settings saved.')
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save settings.')
    }
    setBusy('')
  }

  const googleConnected = syncStatus?.google_connected
  const serverConfigured = syncStatus?.google_configured_server
  const enabledGoogleProducts = syncStatus?.products || []
  const gmailEnabled = enabledGoogleProducts.includes('gmail')

  const THEME_SWATCHES = {
    midnight: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
    ocean: 'linear-gradient(135deg, #031a24, #0891b2)',
    sunset: 'linear-gradient(135deg, #1c1035, #fb7185)',
    forest: 'linear-gradient(135deg, #0b1f15, #059669)',
    lavender: 'linear-gradient(135deg, #170f2e, #8b5cf6)',
    candy: 'linear-gradient(135deg, #1a1230, #0ea5e9)',
    light: 'linear-gradient(135deg, #ffffff, #94a3b8)',
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>

      <div className="card-grid">
        <div className="card">
          <h3>Account</h3>
          <div className="value" style={{ fontSize: 18 }}>{user?.name}</div>
        </div>
        <div className="card">
          <h3>Email</h3>
          <div className="value" style={{ fontSize: 16 }}>{user?.email}</div>
        </div>
        <div className="card">
          <h3>Google</h3>
          <div className="value" style={{ fontSize: 18 }}>
            {googleConnected ? <span style={{ color: '#4ade80' }}>Connected</span> : <span style={{ color: '#94a3b8' }}>Not connected</span>}
          </div>
        </div>
      </div>

      {result && <div className="alert success"><CheckCircle2 size={18} /> {result}</div>}
      {error && <div className="alert error">{error}</div>}

      {/* Google section */}
      <div className="form-card">
        <h3><Cloud size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Google Account &amp; Cloud Backup</h3>

        {!serverConfigured && (
          <div className="notice">
            <strong>Google integration not configured on the server.</strong>
            <p style={{ marginTop: 6, lineHeight: 1.6 }}>
              To enable Google login, Sheets export, Drive backup and Gmail reports, follow the one-time setup
              in Google Cloud Console, then add{' '}
              <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to{' '}
              your Render environment variables and redeploy.
            </p>
          </div>
        )}

        {serverConfigured && (
          <>
            {googleConnected ? (
              <p style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} /> Connected as {syncStatus?.google_email}
              </p>
            ) : (
              <p style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
                Open <strong>My Google</strong> in the sidebar to add only the Google products you want to use.
              </p>
            )}

            {enabledGoogleProducts.some((product) => product === 'sheets' || product === 'drive') && (
              <div className="settings-block">
                {enabledGoogleProducts.includes('sheets') && (
                  <>
                    <h4>Sync to Google Sheets</h4>
                    <div className="form-row">
                      <div className="form-group" style={{ maxWidth: 200 }}>
                        <label>Period</label>
                        <select value={sheetsPeriod} onChange={(e) => setSheetsPeriod(e.target.value)}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                      <button className="btn btn-success" onClick={() => handleSync('sheets')} disabled={busy === 'sheets'}>
                        {busy === 'sheets' ? <Loader2 size={16} className="spin" /> : <Table2 size={16} />}
                        Export to Sheets
                      </button>
                    </div>
                  </>
                )}
                {enabledGoogleProducts.includes('drive') && (
                  <>
                    <h4 style={{ marginTop: 20 }}>Backup to Google Drive</h4>
                    <div className="form-row">
                      <div className="form-group" style={{ maxWidth: 200 }}>
                        <label>Period</label>
                        <select value={drivePeriod} onChange={(e) => setDrivePeriod(e.target.value)}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                      <button className="btn btn-primary" onClick={() => handleSync('drive')} disabled={busy === 'drive'}>
                        {busy === 'drive' ? <Loader2 size={16} className="spin" /> : <HardDrive size={16} />}
                        Backup to Drive
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Email section */}
      <div className="form-card">
        <h3><Mail size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Email Reports</h3>

        <h4>Send a report now</h4>
        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>Period</label>
            <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <button className="btn btn-success" onClick={handleSendReport} disabled={busy === 'report'}>
            {busy === 'report' ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            Send report to my email
          </button>
          <button className="btn btn-outline" onClick={handleTestEmail} disabled={busy === 'test'}>
            {busy === 'test' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Send test email
          </button>
        </div>
        {gmailEnabled ? (
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>
            Emails are sent through your connected Gmail account. You can also configure any SMTP server below.
          </p>
        ) : (
          <p style={{ color: '#fbbf24', fontSize: 13, marginTop: 8 }}>
            Add Gmail in My Google to send through Google, or configure SMTP below (for example, a Gmail App Password).
          </p>
        )}

        <h4 style={{ marginTop: 20 }}>SMTP settings (optional alternative)</h4>
        <div className="form-row">
          <div className="form-group">
            <label>SMTP Host</label>
            <input value={emailCfg.smtp_host} onChange={(e) => setEmailCfg({ ...emailCfg, smtp_host: e.target.value })} placeholder="smtp.gmail.com" />
          </div>
          <div className="form-group" style={{ maxWidth: 110 }}>
            <label>Port</label>
            <input type="number" value={emailCfg.smtp_port} onChange={(e) => setEmailCfg({ ...emailCfg, smtp_port: e.target.value })} />
          </div>
          <div className="form-group">
            <label>User</label>
            <input value={emailCfg.smtp_user} onChange={(e) => setEmailCfg({ ...emailCfg, smtp_user: e.target.value })} placeholder="you@gmail.com" />
          </div>
          <div className="form-group">
            <label>Password (App Password)</label>
            <input type="password" value={emailCfg.smtp_password} onChange={(e) => setEmailCfg({ ...emailCfg, smtp_password: e.target.value })} placeholder="••••••••" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label><AlarmClock size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Daily auto-report time</label>
            <input type="time" value={emailCfg.report_time} onChange={(e) => setEmailCfg({ ...emailCfg, report_time: e.target.value })} />
          </div>
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>Auto-send daily report</label>
            <select value={emailCfg.daily_report ? 1 : 0} onChange={(e) => setEmailCfg({ ...emailCfg, daily_report: e.target.value === '1' })}>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleSaveEmail} disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            Save email settings
          </button>
        </div>
      </div>

      {/* Look & feel section */}
      <div className="form-card">
        <h3><Eye size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> How it looks &amp; sounds for you</h3>
        <p style={{ color: '#94a3b8', marginBottom: 16, fontSize: 13 }}>
          These help everyone use the app comfortably. They are also available from the toolbar at the bottom of any page.
        </p>

        <div className="ui-pref" style={{ marginBottom: 16, background: 'var(--surface-2)' }}>
          <span className="ui-pref-icon"><Palette size={18} /></span>
          <div className="ui-pref-body">
            <strong>Color theme</strong>
            <span className="ui-pref-desc">Pick the look you like best</span>
            <div className="theme-picker">
              {Object.keys(THEMES).map((key) => (
                <div
                  key={key}
                  className={`theme-swatch ${settings.theme === key ? 'active' : ''}`}
                  onClick={() => update({ theme: key })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') update({ theme: key }) }}
                >
                  <div className="theme-swatch-bar" style={{ background: THEME_SWATCHES[key] }}>{THEMES[key]}</div>
                  <span className="theme-swatch-name">{THEMES[key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="ui-pref">
            <span className="ui-pref-icon"><Type size={18} /></span>
            <div className="ui-pref-body">
              <strong>Text size</strong>
              <span className="ui-pref-desc">Make all text bigger or smaller</span>
              <div className="ui-pref-controls">
                <button className="btn btn-outline" onClick={() => update({ fontSize: Math.max(0.85, Math.round((settings.fontSize - 0.15) * 100) / 100) })}>
                  A−
                </button>
                <span className="ui-pref-value">{Math.round(settings.fontSize * 100)}%</span>
                <button className="btn btn-outline" onClick={() => update({ fontSize: Math.min(1.45, Math.round((settings.fontSize + 0.15) * 100) / 100) })}>
                  A+
                </button>
              </div>
            </div>
          </div>

          <div className="ui-pref">
            <span className="ui-pref-icon"><Contrast size={18} /></span>
            <div className="ui-pref-body">
              <strong>High contrast</strong>
              <span className="ui-pref-desc">Easier to read colors</span>
              <div className="ui-pref-controls">
                <button
                  className={`btn ${settings.highContrast ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => update({ highContrast: !settings.highContrast })}
                >
                  {settings.highContrast ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>

          <div className="ui-pref">
            <span className="ui-pref-icon"><Volume2 size={18} /></span>
            <div className="ui-pref-body">
              <strong>Dyslexia-friendly font</strong>
              <span className="ui-pref-desc">A font that is easier to read</span>
              <div className="ui-pref-controls">
                <button
                  className={`btn ${settings.dyslexiaFont ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => update({ dyslexiaFont: !settings.dyslexiaFont })}
                >
                  {settings.dyslexiaFont ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>

          <div className="ui-pref">
            <span className="ui-pref-icon"><MousePointerClick size={18} /></span>
            <div className="ui-pref-body">
              <strong>Big easy buttons</strong>
              <span className="ui-pref-desc">Larger buttons that are easy to tap</span>
              <div className="ui-pref-controls">
                <button
                  className={`btn ${settings.bigButtons ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => update({ bigButtons: !settings.bigButtons })}
                >
                  {settings.bigButtons ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>

          <div className="ui-pref">
            <span className="ui-pref-icon"><Pause size={18} /></span>
            <div className="ui-pref-body">
              <strong>Reduce movement</strong>
              <span className="ui-pref-desc">Turn off 3D motion if it feels too busy</span>
              <div className="ui-pref-controls">
                <button
                  className={`btn ${settings.reduceMotion ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => update({ reduceMotion: !settings.reduceMotion })}
                >
                  {settings.reduceMotion ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account section */}
      <div className="form-card">
        <h3><User size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Account</h3>
        <p style={{ color: '#94a3b8', marginBottom: 16 }}>
          Signed in as <strong style={{ color: '#e2e8f0' }}>{user?.email}</strong>
          {user?.google_email && user?.google_email !== user?.email && ` · Google: ${user.google_email}`}
        </p>
        <button className="btn btn-danger" onClick={logout}>
          <LogOut size={16} /> Log out
        </button>
      </div>
    </div>
  )
}
