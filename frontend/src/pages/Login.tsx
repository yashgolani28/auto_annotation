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
      const errorMsg = e?.response?.data?.detail || "Login failed."
      setErr(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.18),transparent_60%),linear-gradient(to_bottom,rgba(239,246,255,1),rgba(255,255,255,1))] dark:bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.22),transparent_60%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(3,7,18,1))]">
      <div className="w-full max-w-md app-card p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white border border-blue-200 shadow-sm flex items-center justify-center overflow-hidden dark:bg-slate-900 dark:border-blue-900/60">
            <img
              src="/essi_logo.jpeg"
              alt="ESSI"
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = "none"
              }}
            />
          </div>
          <div>
            <div className="text-xl font-semibold">Sign in</div>
            <div className="text-sm muted">MLOps</div>
          </div>
        </div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs font-semibold muted2">Email</label>
            <input className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>

          <div>
            <label className="text-xs font-semibold muted2">Password</label>
            <input
              type="password"
              className="field mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900/40">{err}</div>}

          <button disabled={loading} className="w-full btn-primary py-2.5">
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div className="text-xs muted mt-2">
            Tip: Use your admin credentials to access projects, datasets, training, and exports.
          </div>
        </form>
      </div>
    </div>
  )
}
