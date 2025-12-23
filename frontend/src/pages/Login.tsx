import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../state/auth"

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState("admin@local")
  const [password, setPassword] = useState("admin12345")
  const [err, setErr] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await login(email, password)
      nav("/")
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "login failed")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md bg-white border rounded-2xl p-6 shadow-sm">
        <div className="text-xl font-semibold">sign in</div>
        <div className="text-sm text-zinc-500 mt-1">auto annotator</div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-zinc-600">email</label>
            <input className="mt-1 w-full border rounded-lg px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-600">password</label>
            <input type="password" className="mt-1 w-full border rounded-lg px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button className="w-full bg-zinc-900 text-white rounded-lg py-2">login</button>
        </form>
      </div>
    </div>
  )
}
