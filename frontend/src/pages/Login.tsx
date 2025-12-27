import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../state/auth"

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState("admin@local")
  const [password, setPassword] = useState("admin12345")
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      setLoading(true)
      await login(email, password)
      nav("/")
    } catch (e: any) {
      const errorMsg = e?.response?.data?.detail || "login failed"
      setErr(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.18),transparent_60%),linear-gradient(to_bottom,rgba(239,246,255,1),rgba(255,255,255,1))]">
      <div className="w-full max-w-md bg-white/80 border border-blue-100/80 rounded-3xl p-6 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center overflow-hidden">
            <img
              src="/essi_logo.jpeg"
              alt="essi"
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = "none"
              }}
            />
          </div>
          <div>
            <div className="text-xl font-semibold text-slate-900">sign in</div>
            <div className="text-sm text-slate-500">essi auto annotator</div>
          </div>
        </div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-blue-600 font-medium">email</label>
            <input
              className="mt-1 w-full border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-xs text-blue-600 font-medium">password</label>
            <input
              type="password"
              className="mt-1 w-full border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {err}
            </div>
          )}

          <button
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded-xl py-2.5 font-medium transition-colors shadow-sm"
          >
            {loading ? "logging in..." : "login"}
          </button>
        </form>
      </div>
    </div>
  )
}
