import React, { useEffect, useState } from "react"
import { api } from "../api"
import { Link } from "react-router-dom"

type Project = { id: number; name: string; task_type: string }

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState("")

  async function refresh() {
    const r = await api.get("/api/projects")
    setProjects(r.data)
  }

  useEffect(() => { refresh() }, [])

  async function create() {
    if (!name.trim()) return
    await api.post("/api/projects", { name: name.trim(), task_type: "detection" })
    setName("")
    refresh()
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">projects</div>
          <div className="text-sm text-zinc-500">create, manage, annotate, export</div>
        </div>

        <div className="flex gap-2">
          <input className="border rounded-lg px-3 py-2 w-72" placeholder="new project name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="bg-zinc-900 text-white rounded-lg px-4" onClick={create}>create</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {projects.map(p => (
          <Link key={p.id} to={`/project/${p.id}`} className="bg-white border rounded-2xl p-4 hover:shadow-sm transition">
            <div className="text-lg font-semibold">{p.name}</div>
            <div className="text-xs text-zinc-500">{p.task_type}</div>
            <div className="mt-3 flex gap-3 text-sm text-zinc-700">
              <span>dashboard</span>
              <span>annotate</span>
              <span>auto</span>
              <span>export</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
