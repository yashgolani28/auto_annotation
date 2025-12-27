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
      showToast(e?.response?.data?.detail || "failed to load jobs", "error")
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-2xl font-semibold text-slate-900">jobs</div>
          <div className="text-sm text-slate-500 mt-1">async tasks for this project • auto runs, exports, training</div>
        </div>
        <button
          className={cx(
            "px-4 py-2 rounded-xl border text-sm font-medium transition-colors",
            loading ? "bg-blue-100 text-blue-500 border-blue-200 cursor-not-allowed" : "bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
          )}
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "loading..." : "refresh"}
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4">loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4">no jobs yet for this project.</div>
      ) : (
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">id</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">type</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">status</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">progress</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">message</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">started</th>
                <th className="text-left px-4 py-3 text-slate-900 font-semibold">actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-blue-50 last:border-b-0 hover:bg-blue-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">#{j.id}</td>
                  <td className="px-4 py-3 text-slate-900">{j.job_type}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cx(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        j.status === "success"
                          ? "bg-emerald-100 text-emerald-700"
                          : j.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-blue-100 text-blue-700"
                      )}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-blue-700 font-medium">{Math.round((j.progress || 0) * 100)}%</td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-700" title={j.message}>
                    {j.message}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{new Date(j.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">
                    {j.job_type === "auto_annotate" && (
                      <Link to={`/project/${projectId}/view-auto`} className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
                        view results
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
