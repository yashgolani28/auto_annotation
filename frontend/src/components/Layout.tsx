import React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "../state/auth"

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

function NavItem({ to, label }: { to: string; label: string }) {
  const loc = useLocation()
  const active =
    loc.pathname === to ||
    (to !== "/" && loc.pathname.startsWith(to)) ||
    (to === "/" && loc.pathname === "/")

  return (
    <Link
      to={to}
      className={cx(
        "px-3 py-2 rounded-xl text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "text-slate-700 hover:bg-blue-50 hover:text-blue-800"
      )}
    >
      {label}
    </Link>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth() as any

  return (
    <div
      className={cx(
        "min-h-screen text-slate-900",
        // subtle blue-white background + soft pattern
        "bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.16),transparent_60%),radial-gradient(900px_500px_at_90%_10%,rgba(14,165,233,0.14),transparent_55%),linear-gradient(to_bottom,rgba(239,246,255,1),rgba(255,255,255,1))]"
      )}
    >
      {/* top header */}
      <div className="sticky top-0 z-50 border-b border-blue-100/70 bg-white/70 backdrop-blur">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
            <div className="w-12 h-12 rounded-xl bg-white border-2 border-blue-200 shadow-md flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/essi_logo.jpeg"
                alt="ESSI Logo"
                className="w-full h-full object-contain p-1.5"
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = "none"
                }}
              />
            </div>

            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">
                essi auto annotator
              </div>
              <div className="text-xs text-slate-500 truncate">
                dataset labeling • review • exports
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <NavItem to="/" label="projects" />
            <NavItem to="/admin/users" label="users" />
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:block text-right">
              <div className="text-sm font-medium text-slate-800">
                {user?.name || "user"}
              </div>
              <div className="text-xs text-slate-500">{user?.email || ""}</div>
            </div>

            <button
              className="px-3 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              onClick={() => logout?.()}
            >
              logout
            </button>
          </div>
        </div>
      </div>

      {/* page content */}
      <div className="max-w-7xl mx-auto px-5 py-6">
        <div className="bg-white/70 border border-blue-100/70 rounded-3xl shadow-sm p-5 md:p-6">
          {children}
        </div>
      </div>
    </div>
  )
}
