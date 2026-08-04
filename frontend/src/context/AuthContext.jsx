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
      } catch {
        // token invalid/expired
      }
      cleanUrl()
      setLoading(false)
    }

    handleGoogleToken()
  }, [persist])

  const value = { token, user, login, logout, loading }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
