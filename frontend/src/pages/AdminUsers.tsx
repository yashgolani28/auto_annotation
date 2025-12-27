import React, { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api"
import { useAuth } from "../state/auth"
import { useToast } from "../components/Toast"

type U = { id: number; email: string; name: string; role: string; is_active: boolean }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  input:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  select:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "rounded-xl px-5 py-2.5 font-medium text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "rounded-xl px-4 py-2 text-sm font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  chip:
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium bg-blue-50/80 text-blue-800 border-blue-200/70 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60",
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
      showToast(err?.response?.data?.detail || "Failed to load users", "error")
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
      showToast("Email, name and password are required", "error")
      return
    }
    try {
      setCreating(true)
      await api.post("/api/admin/users", { email: email.trim(), password, name: name.trim(), role })
      setEmail("")
      setPassword("")
      setName("")
      setRole("annotator")
      showToast("User created", "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to create user", "error")
    } finally {
      setCreating(false)
    }
  }

  if (user?.role !== "admin") {
    return (
      <div className="max-w-3xl">
        <div className={cx(UI.card, "p-6")}>
          <div className={cx(UI.h1, "text-lg")}>Forbidden</div>
          <div className={UI.sub}>Admin access required.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className={UI.h1}>Users</div>
          <div className={UI.sub}>Create and manage team accounts.</div>
        </div>

        <div className="w-full md:w-96">
          <input
            className={UI.input}
            placeholder="Search by email, name, role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Create */}
      <div className={cx(UI.card, "p-5 mt-6")}>
        <div className="font-semibold text-slate-900 dark:text-slate-100">Create user</div>
        <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Set role and credentials.</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <input className={UI.input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={UI.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            type="password"
            className={UI.input}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select className={UI.select} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="annotator">Annotator</option>
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button className={cx(UI.btnPrimary, "mt-4")} onClick={create} disabled={creating}>
          {creating ? "Creating…" : "Create user"}
        </button>
      </div>

      {/* List */}
      <div className={cx(UI.card, "p-5 mt-6")}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">Existing users</div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              {loading ? "Loading…" : `${filtered.length} user(s)`}
            </div>
          </div>
          <button className={UI.btnSecondary} onClick={refresh}>
            Refresh
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          {filtered.map((u) => (
            <div
              key={u.id}
              className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-2xl border border-blue-100/70 bg-white/70 p-4 dark:border-blue-900/50 dark:bg-slate-950/30"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{u.email}</div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  {u.name} • <span className="font-medium">{u.role}</span> • ID {u.id}
                </div>
              </div>

              <div
                className={cx(
                  "text-xs px-3 py-1 rounded-full border w-fit font-medium",
                  u.is_active
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50"
                    : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/50"
                )}
              >
                {u.is_active ? "Active" : "Disabled"}
              </div>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="text-sm text-slate-700 dark:text-slate-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
              No users found.
            </div>
          )}
        </div>

        <div className="mt-4">
          <span className={UI.chip}>Tip: Use “Reviewer” for approvals</span>
        </div>
      </div>

      <div className="mt-6">
        <Link to="/" className={UI.btnSecondary}>
          Back to home
        </Link>
      </div>
    </div>
  )
}
