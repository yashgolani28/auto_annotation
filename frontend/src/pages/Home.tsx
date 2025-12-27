import React, { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import { Link } from "react-router-dom"
import { useToast } from "../components/Toast"
import { useAuth } from "../state/auth"

type Project = { id: number; name: string; task_type: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  input:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "rounded-xl px-4 py-2 font-medium text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  badge:
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium border-blue-200/70 bg-blue-50/80 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const { showToast } = useToast()
  const { user } = useAuth()

  const canDelete = useMemo(() => user?.role === "admin" || user?.role === "reviewer", [user?.role])
  const canCreate = useMemo(() => name.trim().length > 0 && !creating, [name, creating])

  async function refresh() {
    try {
      const r = await api.get("/api/projects")
      setProjects(r.data || [])
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load projects", "error")
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function create() {
    if (!name.trim()) return
    try {
      setCreating(true)
      await api.post("/api/projects", { name: name.trim(), task_type: "detection" })
      setName("")
      showToast("Project created", "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to create project", "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className={UI.h1}>Projects</div>
          <div className={UI.sub}>Quick access to setup, annotate, auto-annotate, and export.</div>
        </div>

        <div className={cx(UI.card, "p-3 flex flex-col sm:flex-row gap-2 w-full md:w-auto")}>
          <input
            className={cx(UI.input, "sm:w-80")}
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create()
            }}
          />
          <button className={UI.btnPrimary} onClick={create} disabled={!canCreate}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {projects.map((p) => (
          <div
            key={p.id}
            className={cx(
              "group relative p-5 transition",
              UI.card,
              "hover:shadow-md hover:border-blue-200/80 dark:hover:border-blue-800/60"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{p.task_type}</div>
              </div>
              <span className={UI.badge}>ID {p.id}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Link to={`/project/${p.id}`} className={cx(UI.btnSecondary, "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 dark:bg-sky-600 dark:hover:bg-sky-500 dark:border-sky-700/50 dark:text-white")}>
                Dashboard
              </Link>
              <Link to={`/project/${p.id}/annotate`} className={UI.btnSecondary}>
                Annotate
              </Link>
              <Link to={`/project/${p.id}/auto`} className={UI.btnSecondary}>
                Auto-annotate
              </Link>
              <Link to={`/project/${p.id}/export`} className={UI.btnSecondary}>
                Export
              </Link>
            </div>

            {canDelete && (
              <button
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 text-xs dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-200 dark:hover:bg-rose-950/50"
                onClick={async () => {
                  const ok = confirm(`Delete project "${p.name}" and all its data? This cannot be undone.`)
                  if (!ok) return
                  try {
                    await api.delete(`/api/projects/${p.id}`)
                    showToast("Project deleted", "success")
                    refresh()
                  } catch (err: any) {
                    showToast(err?.response?.data?.detail || "Failed to delete project", "error")
                  }
                }}
                title="Delete project"
              >
                Delete
              </button>
            )}
          </div>
        ))}

        {!projects.length && (
          <div className="col-span-full">
            <div className={cx(UI.card, "p-8 text-center text-slate-700 dark:text-slate-200")}>
              No projects yet. Create one to start.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
