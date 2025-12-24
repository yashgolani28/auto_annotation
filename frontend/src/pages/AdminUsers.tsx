import React, { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import { useAuth } from "../state/auth"
import { useToast } from "../components/Toast"

type U = { id: number; email: string; name: string; role: string; is_active: boolean }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

export default function AdminUsers() {
  const { user } = useAuth()
  const { showToast } = useToast()

  const [users, setUsers] = useState<U[]>([])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("annotator")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  async function refresh() {
    try {
      setLoading(true)
      const r = await api.get("/api/admin/users")
      setUsers(r.data)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "failed to load users", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q)
    )
  }, [users, query])

  async function create() {
    if (!email.trim() || !password.trim() || !name.trim()) {
      showToast("email, name and password are required", "error")
      return
    }
    try {
      setCreating(true)
      await api.post("/api/admin/users", { email: email.trim(), password, name: name.trim(), role })
      setEmail("")
      setPassword("")
      setName("")
      setRole("annotator")
      showToast("user created", "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "failed to create user", "error")
    } finally {
      setCreating(false)
    }
  }

  if (user?.role !== "admin") {
    return (
      <div className="max-w-3xl">
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">forbidden</div>
          <div className="text-sm text-slate-600 mt-1">admin access required.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">users</div>
          <div className="text-sm text-slate-500 mt-1">create and manage team accounts</div>
        </div>

        <div className="w-full md:w-96">
          <input
            className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white/90 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="search by email, name, role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* create */}
      <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 mt-6 shadow-sm">
        <div className="font-semibold text-slate-900">create user</div>
        <div className="text-xs text-slate-500 mt-1">set role and credentials</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <input
            className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="password"
            className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select
            className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="annotator">annotator</option>
            <option value="reviewer">reviewer</option>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>

        <button
          className={cx(
            "mt-4 rounded-xl px-5 py-2.5 font-medium transition-colors",
            creating
              ? "bg-slate-200 text-slate-500 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          )}
          onClick={create}
          disabled={creating}
        >
          {creating ? "creating..." : "create"}
        </button>
      </div>

      {/* list */}
      <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 mt-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900">existing</div>
            <div className="text-xs text-slate-500 mt-1">
              {loading ? "loading..." : `${filtered.length} user(s)`}
            </div>
          </div>
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            onClick={refresh}
          >
            refresh
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          {filtered.map((u) => (
            <div
              key={u.id}
              className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-slate-200 rounded-2xl p-4 bg-white/70"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 truncate">{u.email}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {u.name} • <span className="font-medium text-slate-700">{u.role}</span> • id {u.id}
                </div>
              </div>

              <div
                className={cx(
                  "text-xs px-3 py-1 rounded-full border w-fit",
                  u.is_active
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-red-50 text-red-700 border-red-200"
                )}
              >
                {u.is_active ? "active" : "disabled"}
              </div>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
              no users found.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
