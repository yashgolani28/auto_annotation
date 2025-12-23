import React, { useEffect, useState } from "react"
import { api } from "../api"
import { useAuth } from "../state/auth"

type U = { id: number; email: string; name: string; role: string; is_active: boolean }

export default function AdminUsers() {
  const { user } = useAuth()
  const [users, setUsers] = useState<U[]>([])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("annotator")

  async function refresh() {
    const r = await api.get("/api/admin/users")
    setUsers(r.data)
  }

  useEffect(() => { refresh() }, [])

  async function create() {
    await api.post("/api/admin/users", { email, password, name, role })
    setEmail(""); setPassword(""); setName(""); setRole("annotator")
    refresh()
  }

  if (user?.role !== "admin") return <div className="text-red-600">forbidden</div>

  return (
    <div className="max-w-5xl">
      <div className="text-2xl font-semibold">users</div>
      <div className="text-sm text-zinc-500 mt-1">create team accounts</div>

      <div className="bg-white border rounded-2xl p-4 mt-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="border rounded-lg px-3 py-2" placeholder="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input className="border rounded-lg px-3 py-2" placeholder="name" value={name} onChange={(e)=>setName(e.target.value)} />
          <input className="border rounded-lg px-3 py-2" placeholder="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
          <select className="border rounded-lg px-3 py-2" value={role} onChange={(e)=>setRole(e.target.value)}>
            <option value="annotator">annotator</option>
            <option value="reviewer">reviewer</option>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button className="mt-3 bg-zinc-900 text-white rounded-lg px-4 py-2" onClick={create}>create</button>
      </div>

      <div className="bg-white border rounded-2xl p-4 mt-6">
        <div className="text-sm font-semibold mb-2">existing</div>
        <div className="grid gap-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between border rounded-xl p-3">
              <div>
                <div className="font-medium">{u.email}</div>
                <div className="text-xs text-zinc-500">{u.name} • {u.role}</div>
              </div>
              <div className={`text-xs px-2 py-1 rounded-full ${u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {u.is_active ? "active" : "disabled"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
