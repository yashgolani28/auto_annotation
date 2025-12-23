import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

let accessToken: string | null = null
let refreshToken: string | null = null

export function setTokens(a: string | null, r: string | null) {
  accessToken = a
  refreshToken = r
}

export function getTokens() {
  return { accessToken, refreshToken }
}

export const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && refreshToken && !original.__retried) {
      original.__retried = true
      const rr = await axios.post(`${API_BASE}/api/auth/refresh`, { refresh_token: refreshToken })
      accessToken = rr.data.access_token
      original.headers.Authorization = `Bearer ${accessToken}`
      return axios(original)
    }
    throw err
  }
)

export function mediaUrl(itemId: number) {
  return `${API_BASE}/media/items/${itemId}`
}

export function wsJobUrl(jobId: number) {
  const base = API_BASE.replace("http://", "ws://").replace("https://", "wss://")
  return `${base}/api/ws/jobs/${jobId}`
}
