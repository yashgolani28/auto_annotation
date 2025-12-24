import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'

type Project = { id: number; name: string; task_type: string }

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  async function refresh() {
    try {
      setLoading(true)
      const r = await api.get('/api/projects')
      setProjects(r.data)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load projects", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function create() {
    if (!name.trim()) {
      showToast("Please enter a project name", "error")
      return
    }
    try {
      await api.post('/api/projects', { name: name.trim(), task_type: 'detection' })
      showToast("Project created successfully", "success")
      setName('')
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to create project", "error")
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-2xl font-semibold">Projects</div>
        <div className="text-sm text-zinc-500 mt-1">Create and manage annotation projects</div>
      </div>

      <div className="bg-white border rounded-2xl p-4 mb-6">
        <div className="flex gap-3">
          <input
            className="flex-1 border rounded-lg px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button
            className="bg-zinc-900 text-white rounded-lg px-6 py-2 font-medium"
            onClick={create}
            disabled={loading}
          >
            Create Project
          </button>
        </div>
      </div>

      {loading && projects.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="bg-white border rounded-2xl p-12 text-center">
          <div className="text-zinc-500">No projects yet. Create your first project to get started.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <div key={p.id} className="bg-white border rounded-2xl p-4 hover:shadow-md transition-shadow">
              <div className="font-semibold text-lg mb-1">{p.name}</div>
              <div className="text-xs text-zinc-500 mb-4 uppercase">{p.task_type}</div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/project/${p.id}`}
                  className="px-3 py-1.5 text-sm bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                >
                  Setup
                </Link>
                <Link
                  to={`/project/${p.id}/annotate`}
                  className="px-3 py-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors"
                >
                  Annotate
                </Link>
                <Link
                  to={`/project/${p.id}/auto`}
                  className="px-3 py-1.5 text-sm bg-green-50 hover:bg-green-100 text-green-700 rounded-lg transition-colors"
                >
                  Auto
                </Link>
                <Link
                  to={`/project/${p.id}/export`}
                  className="px-3 py-1.5 text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors"
                >
                  Export
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
