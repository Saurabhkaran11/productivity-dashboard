import React, { useState, useCallback, useMemo, Suspense, lazy, useEffect } from 'react'
import {
  LayoutDashboard, Wallet, ListTodo, Briefcase, CalendarDays,
  FileDown, Settings, LogOut, ShieldCheck, Sparkles, Cloud,
} from 'lucide-react'
import { useAuth } from './context/AuthContext'
import { useUISettings } from './context/SettingsContext'
import useVoice, { supportsVoiceInput } from './hooks/useVoice'
import A11yBar from './components/A11yBar'
import HelpOverlay from './components/HelpOverlay'
import Tooltip from './components/Tooltip'
import Card3D from './components/Card3D'
import Dashboard from './components/Dashboard'
import SpendingTracker from './components/SpendingTracker'
import TodoList from './components/TodoList'
import WorkTracker from './components/WorkTracker'
import Schedule from './components/Schedule'
import ExportSection from './components/ExportSection'
import SettingsPage from './components/SettingsPage'
import GooglePage from './components/GooglePage'
import Login from './components/Login'
import QuickCapture from './components/QuickCapture'

const Scene3D = lazy(() => import('./components/three/Scene3D'))

// Only load the WebGL scene (and the ~1MB three.js libraries) when the device
// actually supports WebGL and the user hasn't disabled it. Keeps the app fast
// on low-end devices and avoids crashes on GPU-less machines.
function useSceneEligible() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let mounted = true
    try {
      const off = localStorage.getItem('pd_disable_3d') === '1'
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      if (mounted) setOk(!off && !!gl)
    } catch {
      if (mounted) setOk(false)
    }
    return () => { mounted = false }
  }, [])
  return ok
}

const SceneBackground = () => {
  const eligible = useSceneEligible()
  if (!eligible) return null
  return (
    <Suspense fallback={null}>
      <Scene3D />
    </Suspense>
  )
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'spending', label: 'Spending', icon: Wallet },
  { id: 'todos', label: 'To-Do List', icon: ListTodo },
  { id: 'work', label: 'Work Tracker', icon: Briefcase },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'google', label: 'My Google', icon: Cloud },
  { id: 'export', label: 'Export', icon: FileDown },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const PAGE_VOICE_TEXT = {
  dashboard: 'You are on the Dashboard page. It shows your spending, work hours, and to-do progress at a glance.',
  spending: 'You are on the Spending page. Add an expense, pick a category and date, and see charts of where your money goes.',
  todos: 'You are on the To-Do List page. Add a task, set its priority, and check it off when it is done.',
  work: 'You are on the Work Tracker page. Log the hours you worked on each task or project.',
  schedule: 'You are on the Schedule page. Plan your day by adding events with a start and end time.',
  google: 'You are on the My Google page. See your Gmail inbox, Drive files, Sheets and Calendar all in one place.',
  export: 'You are on the Export page. Download your data as a PDF or Excel file.',
  settings: 'You are on the Settings page. Connect Google, set up email reports, and change how the app looks for you.',
}

const PAGE_META = {
  dashboard: { eyebrow: 'Your command center', title: 'Daily overview' },
  spending: { eyebrow: 'Financial clarity', title: 'Spending tracker' },
  todos: { eyebrow: 'Stay in motion', title: 'To-do list' },
  work: { eyebrow: 'Deep work', title: 'Work tracker' },
  schedule: { eyebrow: 'Plan your time', title: 'Schedule' },
  google: { eyebrow: 'Connected workspace', title: 'My Google' },
  export: { eyebrow: 'Your data, portable', title: 'Export center' },
  settings: { eyebrow: 'Personalize MyLife', title: 'Settings' },
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const { settings } = useUISettings()
  const [page, setPage] = useState('dashboard')
  const [helpOpen, setHelpOpen] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  }).format(new Date()), [])

  const goToPage = useCallback((id) => {
    if (NAV.some((n) => n.id === id)) setPage(id)
  }, [])

  const announcePage = useCallback((id) => {
    return PAGE_VOICE_TEXT[id] || PAGE_VOICE_TEXT.dashboard
  }, [])

  const voice = useVoice({
    onCommand: (cmd) => {
      const match = [
        ['dashboard', /dashboard|home/],
        ['spending', /spending|money|expense/],
        ['todos', /to[- ]do|todo|task/],
        ['work', /\bwork\b/],
        ['schedule', /schedule|calendar/],
        ['google', /\bgoogle\b|gmail|my google|drive/],
        ['export', /export|download|report/],
        ['settings', /setting/],
        ['help', /help/],
      ].find(([, re]) => re.test(cmd))
      if (!match) {
        voice.speak(`I heard "${cmd}". Try saying a page name like Dashboard, Spending, or To Do List.`)
        return
      }
      if (match[0] === 'help') {
        setHelpOpen(true)
        voice.speak('Opening help. You can also say any page name to go there.')
      } else {
        goToPage(match[0])
        setTimeout(() => voice.speak(announcePage(match[0])), 250)
      }
    },
  })

  const handleAnnounce = useCallback(() => {
    if (!user) {
      voice.speak('Welcome to MyLife. Sign in with your email, or create a free account, to start tracking your day.')
      return
    }
    voice.speak(announcePage(page))
  }, [user, page, voice, announcePage])

  const brand = useMemo(() => (
    <div className="brand-3d" aria-hidden="true">
      <span className="brand-icon"><Sparkles size={26} /></span>
      <span className="brand-text">MyLife</span>
      <span className="brand-float brand-float-1">✦</span>
      <span className="brand-float brand-float-2">✧</span>
      <span className="brand-float brand-float-3">✦</span>
    </div>
  ), [])

  if (loading) {
    return (
      <>
        <SceneBackground />
        <div className="login-page">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div className="login-logo"><ShieldCheck size={36} /></div>
            <p style={{ color: '#94a3b8' }}>Loading…</p>
          </div>
        </div>
        <A11yBar
          speak={voice.speak}
          listening={voice.listening}
          toggleListening={voice.toggleListening}
          voiceSupported={supportsVoiceInput()}
          onAnnounce={handleAnnounce}
          onOpenHelp={() => setHelpOpen(true)}
        />
        {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} speak={voice.speak} />}
      </>
    )
  }

  if (!user) {
    return (
      <>
        <SceneBackground />
        <Login brand={brand} />
        <A11yBar
          speak={voice.speak}
          listening={voice.listening}
          toggleListening={voice.toggleListening}
          voiceSupported={supportsVoiceInput()}
          onAnnounce={handleAnnounce}
          onOpenHelp={() => setHelpOpen(true)}
        />
        {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} speak={voice.speak} />}
      </>
    )
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard refreshKey={dataVersion} />
      case 'spending': return <SpendingTracker refreshKey={dataVersion} />
      case 'todos': return <TodoList refreshKey={dataVersion} />
      case 'work': return <WorkTracker refreshKey={dataVersion} />
      case 'schedule': return <Schedule refreshKey={dataVersion} />
      case 'google': return <GooglePage />
      case 'export': return <ExportSection />
      case 'settings': return <SettingsPage onOpenGoogle={() => goToPage('google')} />
      default: return <Dashboard />
    }
  }

  const pageMeta = PAGE_META[page] || PAGE_META.dashboard

  return (
    <>
      <SceneBackground />
      <div className="app">
        <nav className="sidebar">
          {brand}
          <div className="nav-section-label">Workspace</div>
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.id} label={item.label} side="right">
                <button
                  type="button"
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => { goToPage(item.id); setHelpOpen(false) }}
                  aria-current={page === item.id ? 'page' : undefined}
                >
                  <Icon size={20} />
                  <span className="nav-label">{item.label}</span>
                </button>
              </Tooltip>
            )
          })}
          <div className="sidebar-footer">
            <Tooltip label={`Log out ${user.name}`} side="right">
              <button
                type="button"
                className="nav-item"
                onClick={() => {
                  voice.speak(`Goodbye ${user.name}. You are now logged out.`)
                  setTimeout(logout, 300)
                }}
              >
                <LogOut size={20} />
                <span className="nav-label">{user.name}</span>
              </button>
            </Tooltip>
          </div>
        </nav>
        <main className="main">
          <header className="app-topbar">
            <div>
              <p className="topbar-eyebrow">{pageMeta.eyebrow}</p>
              <p className="topbar-title">{pageMeta.title}</p>
            </div>
            <QuickCapture onCreated={() => setDataVersion((version) => version + 1)} />
            <div className="topbar-actions">
              <span className="today-label">{todayLabel}</span>
              <span className="user-orb" aria-label={`Signed in as ${user.name}`}>{user.name?.slice(0, 1).toUpperCase()}</span>
            </div>
          </header>
          <Card3D className="page-3d" tilt={2.5} scale={1.003}>
            {renderPage()}
          </Card3D>
        </main>
      </div>
      <A11yBar
        speak={voice.speak}
        listening={voice.listening}
        toggleListening={voice.toggleListening}
        voiceSupported={supportsVoiceInput()}
        onAnnounce={handleAnnounce}
        onOpenHelp={() => setHelpOpen(true)}
      />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} speak={voice.speak} />}
    </>
  )
}
