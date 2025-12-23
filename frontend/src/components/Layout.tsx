import React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "../state/auth"

function NavItem({ to, label }: { to: string; label: string }) {
  const loc = useLocation()
  const active = loc.pathname === to || loc.pathname.startsWith(to + "/")
  return (
    <Link
      to={to}
      className={`px-3 py-2 rounded-lg text-sm ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
    >
      {label}
    </Link>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="flex">
        <aside className="w-64 border-r bg-white min-h-screen p-4">
          <div className="text-lg font-semibold">auto annotator</div>
          <div className="text-xs text-zinc-500 mt-1">v2</div>

          <nav className="mt-6 flex flex-col gap-2">
            <NavItem to="/" label="projects" />
            {user?.role === "admin" && <NavItem to="/admin/users" label="users" />}
          </nav>

          <div className="mt-8 border-t pt-4 text-sm">
            <div className="font-medium">{user?.name || user?.email}</div>
            <div className="text-xs text-zinc-500">{user?.role}</div>
            <button className="mt-3 text-sm text-red-600 hover:underline" onClick={logout}>logout</button>
          </div>
        </aside>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
