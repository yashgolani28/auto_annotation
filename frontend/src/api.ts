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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:19',message:'axios request interceptor',data:{url:config.url,baseURL:config.baseURL,fullURL:config.baseURL+config.url,method:config.method,hasAuth:!!accessToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
}, (error) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/8e9a2ab2-7083-455e-b920-69a31115af43',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:request-error',message:'axios request error',data:{errorMessage:error?.message,errorString:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  return Promise.reject(error);
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
  // websocket router is mounted at /ws without the /api prefix
  return `${base}/ws/jobs/${jobId}`
}

export function logoUrl() {
  return `${API_BASE}/media/logo`
}
