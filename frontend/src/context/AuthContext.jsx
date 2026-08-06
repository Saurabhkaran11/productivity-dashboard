import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getMe } from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('pd_token') || '')
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pd_user') || 'null')
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  const persist = useCallback((t, u) => {
    setToken(t)
    setUser(u)
    localStorage.setItem('pd_token', t)
    localStorage.setItem('pd_user', JSON.stringify(u))
  }, [])

  const login = useCallback((t, u) => {
    persist(t, u)
  }, [persist])

  const logout = useCallback(() => {
    setToken('')
    setUser(null)
    localStorage.removeItem('pd_token')
    localStorage.removeItem('pd_user')
  }, [])

  // Handle Google OAuth callback (token passed via ?google_token=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const googleToken = params.get('google_token')
    const cleanUrl = () => window.history.replaceState({}, '', window.location.pathname)

    async function handleGoogleToken() {
      if (!googleToken) {
        setLoading(false)
        return
      }
      try {
        const res = await getMe(googleToken)
        persist(googleToken, res.data)
        // The parent tab receives the storage event above; the temporary
        // OAuth window can now close itself without interrupting the user.
        if (window.opener) {
          window.opener.focus()
          window.close()
        }
      } catch {
        // token invalid/expired
      }
      cleanUrl()
      setLoading(false)
    }

    handleGoogleToken()
  }, [persist])

  // A Google sign-in happens in a small separate window.  Its localStorage
  // update is delivered to this window as a `storage` event, allowing the
  // dashboard to become authenticated without asking the user to refresh.
  useEffect(() => {
    const syncAuth = (event) => {
      if (event.key !== 'pd_token' && event.key !== 'pd_user') return
      const nextToken = localStorage.getItem('pd_token') || ''
      let nextUser = null
      try {
        nextUser = JSON.parse(localStorage.getItem('pd_user') || 'null')
      } catch {
        nextUser = null
      }
      setToken(nextToken)
      setUser(nextUser)
      setLoading(false)
    }

    window.addEventListener('storage', syncAuth)
    return () => window.removeEventListener('storage', syncAuth)
  }, [])

  const value = { token, user, login, logout, loading }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
