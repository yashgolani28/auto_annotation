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
      setProjects(r.data)
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "failed to load projects", "error")
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
      showToast("project created", "success")
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "failed to create project", "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">projects</div>
          <div className="text-sm text-slate-500 mt-1">create, manage, annotate, export</div>
        </div>

        <div className="bg-white/70 border border-blue-100/70 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <input
            className="border border-blue-200 rounded-xl px-3 py-2 w-full sm:w-80 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            placeholder="new project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create()
            }}
          />
          <button
            className={cx(
              "rounded-xl px-4 py-2 font-medium transition-colors",
              canCreate
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-blue-100 text-blue-400 cursor-not-allowed"
            )}
            onClick={create}
            disabled={!canCreate}
          >
            {creating ? "creating..." : "create"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {projects.map((p) => (
          <div
            key={p.id}
            className={cx(
              "group relative",
              "bg-white/80 border border-blue-100/70 rounded-3xl p-5 shadow-sm",
              "hover:shadow-md hover:border-blue-200/80 transition"
            )}
          >
            <Link
              to={`/project/${p.id}`}
              className="block"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold text-slate-900 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{p.task_type}</div>
                </div>

                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                  id {p.id}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  dashboard
                </span>
                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  annotate
                </span>
                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  auto
                </span>
                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  export
                </span>
              </div>

              <div className="mt-4 text-sm text-blue-700 font-medium opacity-0 group-hover:opacity-100 transition">
                open project →
              </div>
            </Link>
            
            {canDelete && (
              <button
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-xs"
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
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
                🗑️
              </button>
            )}
          </div>
        ))}

        {!projects.length && (
          <div className="col-span-full">
            <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-8 text-center text-slate-600">
              no projects yet. create one to start annotating.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
