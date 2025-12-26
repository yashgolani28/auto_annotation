import axios, { AxiosError, InternalAxiosRequestConfig } from "axios"

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"

// ------------------------------------------------------------------
// Token storage (supports multiple legacy keys + always persists)
// ------------------------------------------------------------------
const ACCESS_KEYS = ["access_token", "token", "jwt", "aa_access_token"]
const REFRESH_KEYS = ["refresh_token", "aa_refresh_token"]

function readFirst(keys: string[]): string | null {
  try {
    for (const k of keys) {
      const v = localStorage.getItem(k)
      if (v && v.trim()) return v.trim()
    }
  } catch {
    // ignore (SSR / privacy mode)
  }
  return null
}

function writeToken(key: string, value: string | null) {
  try {
    if (!value) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

let accessToken: string | null = readFirst(ACCESS_KEYS)
let refreshToken: string | null = readFirst(REFRESH_KEYS)

export function setTokens(a: string | null, r: string | null) {
  accessToken = a
  refreshToken = r

  // persist using canonical keys (also keeps your current login working after refresh)
  writeToken("access_token", accessToken)
  writeToken("refresh_token", refreshToken)
}

export function getTokens() {
  return { accessToken, refreshToken }
}

// ------------------------------------------------------------------
// Axios instance
// ------------------------------------------------------------------
export const api = axios.create({
  baseURL: API_BASE,
})

// Attach Authorization header on every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // re-read from localStorage if memory token is missing (page reload etc.)
  if (!accessToken) accessToken = readFirst(ACCESS_KEYS)
  if (!refreshToken) refreshToken = readFirst(REFRESH_KEYS)

  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// One-shot refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original: any = err.config
    const status = err.response?.status

    if (status === 401 && !original?.__retried) {
      // refresh token might exist only in storage
      if (!refreshToken) refreshToken = readFirst(REFRESH_KEYS)

      if (refreshToken) {
        original.__retried = true
        try {
          const rr = await axios.post(
            `${API_BASE}/api/auth/refresh`,
            { refresh_token: refreshToken },
            { headers: { "Content-Type": "application/json" } }
          )

          const newAccess = (rr.data as any)?.access_token as string | undefined
          if (newAccess && newAccess.trim()) {
            setTokens(newAccess.trim(), refreshToken)
            original.headers = original.headers ?? {}
            original.headers.Authorization = `Bearer ${newAccess.trim()}`
            return axios(original)
          }
        } catch {
          // refresh failed → clear tokens
          setTokens(null, null)
        }
      } else {
        // no refresh token → clear tokens
        setTokens(null, null)
      }
    }

    throw err
  }
)

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
export function mediaUrl(itemId: number) {
  return `${API_BASE}/media/items/${itemId}`
}

export function mediaUrlCandidates(itemId: number) {
  const a = `${API_BASE}/media/items/${itemId}`
  const b = `${API_BASE}/api/media/items/${itemId}`
  return Array.from(new Set([a, b]))
}

export function wsJobUrl(jobId: number) {
  const base = API_BASE.replace("http://", "ws://").replace("https://", "wss://")
  // websocket router is mounted at /ws without the /api prefix
  return `${base}/ws/jobs/${jobId}`
}

export function logoUrl() {
  return `${API_BASE}/media/logo`
}

export function logoUrlCandidates() {
  const a = `${API_BASE}/media/logo`
  const b = `${API_BASE}/api/media/logo`
  return Array.from(new Set([a, b]))
}