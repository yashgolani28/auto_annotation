import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
export const api = axios.create({ baseURL: API_BASE })

export function mediaUrl(itemId: number) {
  return `${API_BASE}/media/items/${itemId}`
}
