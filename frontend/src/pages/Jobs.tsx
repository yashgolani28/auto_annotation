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
          className="px-3 py-1.5 rounded-lg border text-sm"
          onClick={refresh}
          disabled={loading}
        >
          refresh
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-sm text-zinc-500">loading jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-zinc-500">no jobs yet for this project.</div>
      ) : (
        <div className="bg-white border rounded-2xl overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">id</th>
                <th className="text-left px-4 py-2">type</th>
                <th className="text-left px-4 py-2">status</th>
                <th className="text-left px-4 py-2">progress</th>
                <th className="text-left px-4 py-2">message</th>
                <th className="text-left px-4 py-2">started</th>
                <th className="text-left px-4 py-2">actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs">#{j.id}</td>
                  <td className="px-4 py-2">{j.job_type}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        j.status === "success"
                          ? "bg-green-100 text-green-700"
                          : j.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {Math.round((j.progress || 0) * 100)}%
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate" title={j.message}>
                    {j.message}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {j.job_type === "auto_annotate" && (
                      <Link
                        to={`/project/${projectId}/auto`}
                        className="text-blue-600 hover:underline"
                      >
                        view auto page
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


