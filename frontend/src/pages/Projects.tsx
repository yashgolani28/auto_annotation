import React, { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import { Link } from "react-router-dom"
import { useToast } from "../components/Toast"
import { useAuth } from "../state/auth"

type Project = { id: number; name: string; task_type: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const { showToast } = useToast()
  const { user } = useAuth()
  const canDelete = useMemo(() => user?.role === "admin" || user?.role === "reviewer", [user?.role])

  async function refresh() {
    try {
      const r = await api.get("/api/projects")
      setProjects(r.data || [])
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Failed to load projects.", "error")
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const canCreate = useMemo(() => name.trim().length > 0 && !creating, [name, creating])

  async function create() {
    if (!name.trim()) return
    try {
      setCreating(true)
      await api.post("/api/projects", { name: name.trim(), task_type: "detection" })
      setName("")
      await refresh()
      showToast("Project created.", "success")
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Failed to create project.", "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold">Projects</div>
          <div className="text-sm muted mt-1">Create, manage, annotate, train, and export datasets.</div>
        </div>

        <div className="app-card-solid rounded-2xl p-3 flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <input
            className="field w-full sm:w-80"
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create()
            }}
          />
          <button className={cx("btn-primary", !canCreate && "opacity-60 cursor-not-allowed")} onClick={create} disabled={!canCreate}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {projects.map((p) => (
          <div key={p.id} className="group relative app-card p-5 hover:shadow-md transition">
            <Link to={`/project/${p.id}`} className="block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold truncate">{p.name}</div>
                  <div className="text-xs muted mt-1">Task type: {p.task_type}</div>
                </div>

                <span className="badge shrink-0">ID {p.id}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                {["Dashboard", "Annotate", "Auto annotate", "Train", "Export"].map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-300 opacity-0 group-hover:opacity-100 transition">
                Open project →
              </div>
            </Link>

            {canDelete && (
              <button
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-xs dark:bg-red-950/25 dark:border-red-900/40 dark:text-red-200"
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const ok = confirm(`Delete project "${p.name}" and all its data? This cannot be undone.`)
                  if (!ok) return
                  try {
                    await api.delete(`/api/projects/${p.id}`)
                    showToast("Project deleted.", "success")
                    refresh()
                  } catch (err: any) {
                    showToast(err?.response?.data?.detail || "Failed to delete project.", "error")
                  }
                }}
                title="Delete project"
              >
                🗑️
              </button>
            )}
          </div>
        ))}

        {!projects.length && (
          <div className="col-span-full">
            <div className="app-card p-8 text-center muted">No projects yet. Create one to start.</div>
          </div>
        )}
      </div>
    </div>
  )
}
