import React, { useState, useEffect, useCallback } from 'react'
import {
  Mail, HardDrive, Table2, CalendarDays, ExternalLink, Loader2,
  Cloud, Search, RefreshCw, Clock, FileText, Folder, FileSpreadsheet,
  Inbox, AlertCircle, ChevronDown, MailOpen, MailPlus, CalendarRange, CheckSquare, Plus,
} from 'lucide-react'
import {
  getSyncStatus,
  listGmail, readGmail, listDrive, listSheets, listCalendar,
  listGoogleTasks, addGoogleTask, updateGoogleTask,
} from '../utils/api'
import Collapsible from './Collapsible'
import GoogleConnectionManager from './GoogleConnectionManager'

const TABS = [
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'drive', label: 'Drive', icon: HardDrive },
  { id: 'sheets', label: 'Sheets', icon: Table2 },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
]

function formatBytes(bytes) {
  if (!bytes) return ''
  const n = Number(bytes)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function driveIcon(mime) {
  if (mime === 'application/vnd.google-apps.folder') return <Folder size={18} />
  if (mime === 'application/vnd.google-apps.spreadsheet') return <FileSpreadsheet size={18} />
  if (mime && mime.startsWith('application/pdf')) return <FileText size={18} />
  return <FileText size={18} />
}

function driveLabel(mime) {
  const map = {
    'application/vnd.google-apps.folder': 'Folder',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.drawing': 'Drawing',
    'application/vnd.google-apps.photo': 'Photo',
  }
  return map[mime] || mime?.split('/').pop()?.toUpperCase() || 'File'
}

export default function GooglePage() {
  const [status, setStatus] = useState(null)
  const [enabledProducts, setEnabledProducts] = useState([])
  const [tab, setTab] = useState('gmail')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const [gmailQuery, setGmailQuery] = useState('')
  const [gmailList, setGmailList] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [reading, setReading] = useState(false)

  const [driveQuery, setDriveQuery] = useState('')
  const [driveList, setDriveList] = useState([])

  const [sheetsList, setSheetsList] = useState([])
  const [events, setEvents] = useState([])
  const [googleTasks, setGoogleTasks] = useState([])
  const [newGoogleTask, setNewGoogleTask] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const res = await getSyncStatus()
      setStatus(res.data)
    } catch (e) { setError('Could not load Google status.') }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const googleConnected = status?.google_connected
  const serverConfigured = status?.google_configured_server
  const activeTabs = TABS.filter((item) => enabledProducts.includes(item.id))

  const updateEnabledProducts = useCallback((products) => {
    setEnabledProducts(products)
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (activeTabs.length && !enabledProducts.includes(tab)) setTab(activeTabs[0].id)
  }, [activeTabs.length, enabledProducts, tab])

  const setTabError = (e, label) => {
    setError(e.response?.data?.detail || `Could not load ${label}. Make sure Google is connected.`)
  }

  async function loadGmail() {
    setBusy('gmail')
    setError('')
    try {
      const res = await listGmail(gmailQuery, 25)
      setGmailList(res.data.messages)
    } catch (e) { setTabError(e, 'Gmail') }
    setBusy('')
  }

  async function loadDrive() {
    setBusy('drive')
    setError('')
    try {
      const res = await listDrive(driveQuery, 100)
      setDriveList(res.data.files)
    } catch (e) { setTabError(e, 'Drive') }
    setBusy('')
  }

  async function loadSheets() {
    setBusy('sheets')
    setError('')
    try {
      const res = await listSheets(100)
      setSheetsList(res.data.files)
    } catch (e) { setTabError(e, 'Sheets') }
    setBusy('')
  }

  async function loadCalendar() {
    setBusy('calendar')
    setError('')
    try {
      const res = await listCalendar(30)
      setEvents(res.data.events)
    } catch (e) { setTabError(e, 'Calendar') }
    setBusy('')
  }

  async function loadGoogleTasks() {
    setBusy('tasks')
    setError('')
    try {
      const res = await listGoogleTasks(100)
      setGoogleTasks(res.data.tasks)
    } catch (e) { setTabError(e, 'Google Tasks') }
    setBusy('')
  }

  async function createGoogleTask(e) {
    e.preventDefault()
    const title = newGoogleTask.trim()
    if (!title) return
    setBusy('task-create')
    setError('')
    try {
      const res = await addGoogleTask({ title })
      setGoogleTasks((current) => [res.data, ...current])
      setNewGoogleTask('')
    } catch (err) { setTabError(err, 'Google Tasks') }
    setBusy('')
  }

  async function toggleGoogleTask(task) {
    setBusy(`task-${task.id}`)
    setError('')
    try {
      const res = await updateGoogleTask(task.task_list_id, task.id, task.status !== 'completed')
      setGoogleTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...res.data } : item))
    } catch (err) { setTabError(err, 'Google Tasks') }
    setBusy('')
  }

  function switchTab(id) {
    setTab(id)
    setError('')
    setExpanded(null)
    if (id === 'gmail' && !gmailList.length) loadGmail()
    if (id === 'drive' && !driveList.length) loadDrive()
    if (id === 'sheets' && !sheetsList.length) loadSheets()
    if (id === 'calendar' && !events.length) loadCalendar()
    if (id === 'tasks' && !googleTasks.length) loadGoogleTasks()
  }

  async function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setReading(true)
    try {
      const found = gmailList.find((m) => m.id === id)
      if (!found?.body) {
        const res = await readGmail(id)
        found.body = res.data.body
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not open email.')
    }
    setReading(false)
  }

  function renderGmail() {
    return (
      <div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-faint)' }} />
              <input
                style={{ paddingLeft: 36 }}
                placeholder="Search your inbox (e.g. from:bank subject:bill)"
                value={gmailQuery}
                onChange={(e) => setGmailQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadGmail() }}
              />
            </div>
          </div>
          <button className="btn btn-primary" onClick={loadGmail} disabled={busy === 'gmail'}>
            {busy === 'gmail' ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            Search
          </button>
          <button className="btn btn-outline" onClick={loadGmail} disabled={busy === 'gmail'}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <Collapsible title="Inbox" count={gmailList.length}>
          <div className="google-list">
            {gmailList.length === 0 && !busy && (
              <div className="google-empty">
                <Inbox size={36} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />
                <div>No emails found.</div>
              </div>
            )}
            {gmailList.map((m) => (
              <div key={m.id}>
                <div className="google-item" onClick={() => toggleExpand(m.id)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleExpand(m.id) }}
                  style={{ cursor: 'pointer' }}>
                  <span className="google-item-icon">
                    {m.unread ? <MailPlus size={18} /> : <MailOpen size={18} />}
                  </span>
                  <div className="google-item-body">
                    <div className="google-item-title">
                      {m.subject}
                      {m.unread && <span className="mail-unread-badge">unread</span>}
                    </div>
                    <div className="google-item-meta">{m.from} · {m.date}</div>
                    <div className="google-item-sub">{m.snippet}</div>
                  </div>
                  <div className="google-item-actions">
                    <a href={`https://mail.google.com/mail/u/0/#inbox/${m.id}`} target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="btn btn-outline" title="Open in Gmail">
                      <ExternalLink size={14} />
                    </a>
                    <span className="collapsible-chevron" style={{ transform: expanded === m.id ? 'rotate(90deg)' : 'none' }}>
                      <ChevronDown size={16} />
                    </span>
                  </div>
                </div>
                {expanded === m.id && (
                  <div className="form-card" style={{ marginTop: 8, borderRadius: 10 }}>
                    {reading ? (
                      <p style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Loader2 size={14} className="spin" /> Opening email…
                      </p>
                    ) : (
                      <div>
                        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 10 }}>
                          <strong style={{ color: 'var(--text-strong)' }}>From:</strong> {gmailList.find((x) => x.id === m.id)?.from}
                        </p>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--text)', fontSize: 14 }}>
                          {gmailList.find((x) => x.id === m.id)?.body || '(No plain-text body)'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Collapsible>
      </div>
    )
  }

  function renderDrive() {
    return (
      <div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-faint)' }} />
              <input
                style={{ paddingLeft: 36 }}
                placeholder="Search Drive (e.g. name contains 'report')"
                value={driveQuery}
                onChange={(e) => setDriveQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadDrive() }}
              />
            </div>
          </div>
          <button className="btn btn-primary" onClick={loadDrive} disabled={busy === 'drive'}>
            {busy === 'drive' ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            Search
          </button>
        </div>

        <Collapsible title="Files" count={driveList.length}>
          <div className="google-list">
            {driveList.length === 0 && !busy && (
              <div className="google-empty"><HardDrive size={36} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />No files found.</div>
            )}
            {driveList.map((f) => (
              <div className="google-item" key={f.id}>
                <span className="google-item-icon">{driveIcon(f.mimeType)}</span>
                <div className="google-item-body">
                  <div className="google-item-title">{f.name}</div>
                  <div className="google-item-meta">
                    {driveLabel(f.mimeType)}
                    {f.size ? ` · ${formatBytes(f.size)}` : ''}
                    {f.modifiedTime ? ` · ${shortDate(f.modifiedTime)}` : ''}
                  </div>
                </div>
                <div className="google-item-actions">
                  {f.webViewLink ? (
                    <a href={f.webViewLink} target="_blank" rel="noreferrer" className="btn btn-outline" title="Open">
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      </div>
    )
  }

  function renderSheets() {
    return (
      <div>
        <Collapsible title="Google Sheets" count={sheetsList.length}>
          <div className="google-list">
            {sheetsList.length === 0 && !busy && (
              <div className="google-empty"><Table2 size={36} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />No spreadsheets found.</div>
            )}
            {sheetsList.map((f) => (
              <div className="google-item" key={f.id}>
                <span className="google-item-icon"><FileSpreadsheet size={18} /></span>
                <div className="google-item-body">
                  <div className="google-item-title">{f.name}</div>
                  <div className="google-item-meta">{f.modifiedTime ? `Modified ${shortDate(f.modifiedTime)}` : 'Google Sheet'}</div>
                </div>
                <div className="google-item-actions">
                  {f.webViewLink && (
                    <a href={f.webViewLink} target="_blank" rel="noreferrer" className="btn btn-outline" title="Open in Sheets">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      </div>
    )
  }

  function renderCalendar() {
    return (
      <div>
        <Collapsible title="Upcoming events" count={events.length}>
          <div className="google-list">
            {events.length === 0 && !busy && (
              <div className="google-empty"><CalendarDays size={36} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />No upcoming events.</div>
            )}
            {events.map((ev) => {
              const start = ev.start?.dateTime || ev.start?.date
              return (
                <div className="google-item" key={ev.id}>
                  <span className="google-item-icon"><Clock size={18} /></span>
                  <div className="google-item-body">
                    <div className="google-item-title">{ev.summary || '(No title)'}</div>
                    <div className="google-item-meta">{shortDate(start)}</div>
                    {ev.location && <div className="google-item-sub">📍 {ev.location}</div>}
                    {ev.description && <div className="google-item-sub">{ev.description}</div>}
                  </div>
                  <div className="google-item-actions">
                    <a
                      href={`https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(ev.summary || '')}`}
                      target="_blank" rel="noreferrer" className="btn btn-outline" title="Open in Calendar">
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </Collapsible>
      </div>
    )
  }

  function renderTasks() {
    return (
      <div>
        <form className="form-row" onSubmit={createGoogleTask} style={{ marginBottom: 16 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <input
              placeholder="Add a Google Task…"
              value={newGoogleTask}
              onChange={(e) => setNewGoogleTask(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy === 'task-create'}>
            {busy === 'task-create' ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            Add task
          </button>
          <button className="btn btn-outline" type="button" onClick={loadGoogleTasks} disabled={busy === 'tasks'}>
            <RefreshCw size={16} /> Refresh
          </button>
        </form>
        <Collapsible title="Google Tasks" count={googleTasks.length}>
          <div className="google-list">
            {googleTasks.length === 0 && !busy && (
              <div className="google-empty"><CheckSquare size={36} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />No tasks found.</div>
            )}
            {googleTasks.map((task) => {
              const completed = task.status === 'completed'
              return (
                <div className="google-item" key={task.id}>
                  <input
                    type="checkbox"
                    checked={completed}
                    disabled={busy === `task-${task.id}`}
                    onChange={() => toggleGoogleTask(task)}
                    aria-label={`Mark ${task.title} ${completed ? 'incomplete' : 'complete'}`}
                  />
                  <div className="google-item-body">
                    <div className="google-item-title" style={completed ? { textDecoration: 'line-through', opacity: .65 } : undefined}>{task.title}</div>
                    {task.notes && <div className="google-item-sub">{task.notes}</div>}
                    {task.due && <div className="google-item-meta">Due {shortDate(task.due)}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </Collapsible>
      </div>
    )
  }

  return (
    <div>
      <h1 className="page-title">My Google Data</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 18, fontSize: 14 }}>
        Add only the Google tools you use, then manage them in one focused workspace.
      </p>

      <GoogleConnectionManager onProductsChange={updateEnabledProducts} />

      {serverConfigured && activeTabs.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontSize: 14 }}>
              <MailOpen size={16} /> Connected as {status?.google_email}
            </span>
            <a href="https://myaccount.google.com/" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ marginLeft: 'auto' }}>
              <ExternalLink size={14} /> Google Account
            </a>
          </div>

          {error && <div className="alert error">{error}</div>}

          <div className="google-tabs">
            {activeTabs.map((t) => {
              const Icon = t.icon
              return (
                <button key={t.id} className={`google-tab ${tab === t.id ? 'active' : ''}`} onClick={() => switchTab(t.id)}>
                  <Icon size={16} /> {t.label}
                </button>
              )
            })}
          </div>

          <div className="form-card" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            {busy && !['gmail', 'drive', 'sheets', 'calendar', 'tasks'].includes(busy) ? null : (
              busy === 'gmail' && tab === 'gmail' ? (
                <div className="google-empty" style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                  <Loader2 size={18} className="spin" /> Loading your Gmail…
                </div>
              ) : null
            )}
            {tab === 'gmail' && renderGmail()}
            {tab === 'drive' && renderDrive()}
            {tab === 'sheets' && renderSheets()}
            {tab === 'calendar' && renderCalendar()}
            {tab === 'tasks' && renderTasks()}
          </div>
        </>
      )}

      {serverConfigured && activeTabs.length === 0 && (
        <div className="google-empty">
          <Cloud size={34} style={{ marginBottom: 10, color: 'var(--text-faint)' }} />
          <div>Add a Google product above to begin.</div>
        </div>
      )}
    </div>
  )
}
