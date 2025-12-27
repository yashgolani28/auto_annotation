import React, { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api } from "../api"
import { useToast } from "../components/Toast"

type Job = {
  id: number
  job_type: string
  status: string
  progress: number
  message: string
  payload: any
  created_at: string
  updated_at: string
}

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  btnSecondary:
    "rounded-xl px-4 py-2 text-sm font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  badgeBase: "px-2.5 py-1 rounded-full text-xs font-medium border",
}

export default function Jobs() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh() {
    if (!projectId) return
    setLoading(true)
    try {
      const r = await api.get(`/api/projects/${projectId}/jobs`)
      setJobs(r.data || [])
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Failed to load jobs", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
        <div>
          <div className={UI.h1}>Jobs</div>
          <div className={UI.sub}>Async tasks for this project (auto-annotation, exports, training).</div>
          <div className="mt-3">
            <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
              Back to project
            </Link>
          </div>
        </div>

        <button className={UI.btnSecondary} onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
          Loading jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
          No jobs yet for this project.
        </div>
      ) : (
        <div className={cx(UI.card, "overflow-hidden")}>
          <table className="min-w-full text-sm">
            <thead className="bg-blue-50/80 dark:bg-blue-950/30 border-b border-blue-100/70 dark:border-blue-900/50">
              <tr>
                {["ID", "Type", "Status", "Progress", "Message", "Started", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-slate-900 dark:text-slate-100 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className="border-b border-blue-50 dark:border-blue-900/30 last:border-b-0 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">#{j.id}</td>
                  <td className="px-4 py-3 text-slate-900 dark:text-slate-100">{j.job_type}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        UI.badgeBase,
                        j.status === "success"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50"
                          : j.status === "failed"
                          ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/50"
                          : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60"
                      )}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-blue-700 dark:text-blue-200 font-medium">
                    {Math.round((j.progress || 0) * 100)}%
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-700 dark:text-slate-300" title={j.message}>
                    {j.message}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {j.job_type === "auto_annotate" && (
                      <Link
                        to={`/project/${projectId}/view-auto`}
                        className="text-blue-700 dark:text-blue-200 hover:underline font-medium"
                      >
                        View results
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
