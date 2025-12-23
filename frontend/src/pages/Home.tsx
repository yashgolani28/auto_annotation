import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { Link } from 'react-router-dom'

type Project = { id: number; name: string; task_type: string }

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')

  async function refresh() {
    const r = await api.get('/api/projects')
    setProjects(r.data)
  }

  useEffect(() => { refresh() }, [])

  async function create() {
    if (!name.trim()) return
    await api.post('/api/projects', { name: name.trim(), task_type: 'detection' })
    setName('')
    refresh()
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2>projects</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="project name" />
        <button onClick={create}>create</button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {projects.map(p => (
          <div key={p.id} style={{ border: '1px solid #eee', padding: 12 }}>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{p.task_type}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
              <Link to={`/project/${p.id}`}>setup</Link>
              <Link to={`/project/${p.id}/annotate`}>annotate</Link>
              <Link to={`/project/${p.id}/auto`}>auto</Link>
              <Link to={`/project/${p.id}/export`}>export</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
