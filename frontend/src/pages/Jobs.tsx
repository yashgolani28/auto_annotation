import React, { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api } from "../api"

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

export default function Jobs() {
  const { id } = useParams()
  const projectId = Number(id)
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh() {
    if (!projectId) return
    setLoading(true)
    try {
      const r = await api.get(`/api/projects/${projectId}/jobs`)
      setJobs(r.data)
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
          <div className="text-2xl font-semibold">jobs</div>
          <div className="text-sm text-zinc-500 mt-1">
            async tasks for this project • auto annotation runs and exports
          </div>
        </div>
        <button
          className="px-3 py-1.5 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 text-sm transition-colors"
          onClick={refresh}
          disabled={loading}
        >
          refresh
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-sm text-blue-600">loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-xl p-4">no jobs yet for this project.</div>
      ) : (
        <div className="bg-white/80 border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-blue-50 border-b border-blue-200">
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
                <tr key={j.id} className="border-b border-blue-100 last:border-b-0 hover:bg-blue-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">#{j.id}</td>
                  <td className="px-4 py-3 text-slate-900">{j.job_type}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        j.status === "success"
                          ? "bg-green-100 text-green-700"
                          : j.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-blue-700 font-medium">
                    {Math.round((j.progress || 0) * 100)}%
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-700" title={j.message}>
                    {j.message}
                  </td>
                  <td className="px-4 py-3 text-xs text-blue-600">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {j.job_type === "auto_annotate" && (
                      <Link
                        to={`/project/${projectId}/view-auto`}
                        className="text-blue-600 hover:text-blue-700 hover:underline font-medium"
                      >
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


