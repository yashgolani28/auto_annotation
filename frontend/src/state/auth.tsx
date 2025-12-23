import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import { api, setTokens } from "../api"

type User = { id: number; email: string; name: string; role: string }
type Ctx = {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("aa_access"))
  const [refreshToken, setRefreshToken] = useState<string | null>(localStorage.getItem("aa_refresh"))

  useEffect(() => {
    setTokens(accessToken, refreshToken)
  }, [accessToken, refreshToken])

  async function login(email: string, password: string) {
    const r = await api.post("/api/auth/login", { email, password })
    setAccessToken(r.data.access_token)
    setRefreshToken(r.data.refresh_token)
    localStorage.setItem("aa_access", r.data.access_token)
    localStorage.setItem("aa_refresh", r.data.refresh_token)
    setTokens(r.data.access_token, r.data.refresh_token)
    setUser(r.data.user)
  }

  async function logout() {
    try {
      await api.post("/api/auth/logout", { refresh_token: refreshToken })
    } catch {}
    setUser(null)
    setAccessToken(null)
    setRefreshToken(null)
    setTokens(null, null)
    localStorage.removeItem("aa_access")
    localStorage.removeItem("aa_refresh")
  }

  async function hydrate() {
    if (!accessToken) return
    try {
      const r = await api.get("/api/auth/me")
      setUser(r.data)
    } catch {
      // ignore
    }
  }

  useEffect(() => { hydrate() }, [])

  const value = useMemo(() => ({ user, accessToken, refreshToken, login, logout }), [user, accessToken, refreshToken])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const v = useContext(AuthCtx)
  if (!v) throw new Error("AuthProvider missing")
  return v
}
