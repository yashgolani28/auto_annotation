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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.tsx:24',message:'login function entry',data:{email,passwordLength:password?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.tsx:25',message:'before api.post request',data:{url:'/api/auth/login',payloadType:'json',hasEmail:!!email,hasPassword:!!password},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const r = await api.post("/api/auth/login", { email, password })
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.tsx:26',message:'api.post success',data:{status:r.status,hasAccessToken:!!r.data?.access_token,hasRefreshToken:!!r.data?.refresh_token,hasUser:!!r.data?.user},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setAccessToken(r.data.access_token)
      setRefreshToken(r.data.refresh_token)
      localStorage.setItem("aa_access", r.data.access_token)
      localStorage.setItem("aa_refresh", r.data.refresh_token)
      setTokens(r.data.access_token, r.data.refresh_token)
      setUser(r.data.user || null)
    } catch (err: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'auth.tsx:33',message:'api.post error caught',data:{errorMessage:err?.message,status:err?.response?.status,statusText:err?.response?.statusText,detail:err?.response?.data?.detail,isNetworkError:!err?.response},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      throw err;
    }
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
