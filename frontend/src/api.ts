import axios, { AxiosError, InternalAxiosRequestConfig } from "axios"

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"

// ------------------------------------------------------------------
// Token storage
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
    // ignore
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
  if (!accessToken) accessToken = readFirst(ACCESS_KEYS)
  if (!refreshToken) refreshToken = readFirst(REFRESH_KEYS)

  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original: any = err.config
    const status = err.response?.status

    if (status === 401 && original && !original.__retried) {
      original.__retried = true

      try {
        const refresh = localStorage.getItem("refresh_token") || localStorage.getItem("aa_refresh_token")
        if (!refresh) throw new Error("no refresh token")

        const rr = await axios.post(
          `${API_BASE}/api/auth/refresh`,
          { refresh_token: refresh },
          { headers: { "Content-Type": "application/json" } }
        )

        const newAccess = rr.data?.access_token
        if (!newAccess) throw new Error("no access token")

        localStorage.setItem("access_token", newAccess)

        // ensure retry hits backend, not frontend origin
        original.baseURL = API_BASE
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${newAccess}`

        // IMPORTANT: retry using same api instance
        return api.request(original)
      } catch (e) {
        localStorage.removeItem("access_token")
        localStorage.removeItem("refresh_token")
        throw err
      }
    }

    throw err
  }
)


// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
export function mediaUrl(itemId: number) {
  // kept for compatibility, but protected endpoints won't work via <img/> directly
  return `${API_BASE}/media/items/${itemId}`
}

export function mediaUrlCandidates(itemId: number) {
  // include ALL common backend route variants
  const xs = [
    `${API_BASE}/media/items/${itemId}`,
    `${API_BASE}/api/media/items/${itemId}`,
    `${API_BASE}/api/items/${itemId}/media`,
    `${API_BASE}/api/items/${itemId}/image`,
    `${API_BASE}/api/items/${itemId}/file`,
  ]
  return Array.from(new Set(xs))
}

export function wsJobUrl(jobId: number) {
  const base = API_BASE.replace("http://", "ws://").replace("https://", "wss://")
  return `${base}/ws/jobs/${jobId}`
}

export function logoUrl() {
  return `${API_BASE}/media/logo`
}

export function logoUrlCandidates() {
  const xs = [`${API_BASE}/media/logo`, `${API_BASE}/api/media/logo`]
  return Array.from(new Set(xs))
}

export function jobTrainYoloLiveCsvUrl(jobId: number, limit: number = 15) {
  return `${API_BASE}/api/jobs/${jobId}/train-yolo/live-csv?limit=${encodeURIComponent(String(limit))}`
}

export function jobTrainYoloSummaryUrl(jobId: number) {
  return `${API_BASE}/api/jobs/${jobId}/train-yolo/summary`
}

function encodePathPreserveSlashes(p: string) {
  const cleaned = (p || "").replace(/^\/+/, "").replace(/\\/g, "/")
  return cleaned
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/")
}

export function jobTrainYoloArtifactUrl(jobId: number, relPath: string) {
  const enc = encodePathPreserveSlashes(relPath)
  return `${API_BASE}/api/jobs/${jobId}/train-yolo/artifact/${enc}`
}

export function trainedModelsUrl(projectId: number) {
  return `/api/projects/${projectId}/trained-models`
}

export function trainedModelDownloadUrl(projectId: number, modelId: number, kind: "model" | "report") {
  return `${API_BASE}/api/projects/${projectId}/trained-models/${modelId}/download/${kind}`
}
