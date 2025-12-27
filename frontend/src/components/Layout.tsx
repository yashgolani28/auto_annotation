import React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "../state/auth"
import { useTheme } from "../state/theme"

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
          : "text-slate-700 hover:bg-blue-50 hover:text-blue-800 dark:text-slate-200 dark:hover:bg-blue-950/40 dark:hover:text-blue-200"
      )}
    >
      {label}
    </Link>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button
      className={cx(
        "px-3 py-2 rounded-xl text-sm font-medium transition-colors",
        "border border-blue-200/70 bg-white/70 hover:bg-white text-slate-800",
        "dark:border-blue-900/60 dark:bg-slate-900/60 dark:hover:bg-slate-900/80 dark:text-slate-100"
      )}
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth() as any

  return (
    <div
      className={cx(
        "min-h-screen",
        "text-slate-900 dark:text-slate-100",
        // Light: light blue + white. Dark: deep blue base.
        "bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.16),transparent_60%),radial-gradient(900px_500px_at_90%_10%,rgba(14,165,233,0.14),transparent_55%),linear-gradient(to_bottom,rgba(239,246,255,1),rgba(255,255,255,1))]",
        "dark:bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(37,99,235,0.22),transparent_60%),radial-gradient(900px_500px_at_90%_10%,rgba(14,165,233,0.18),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(3,7,18,1))]"
      )}
    >
      {/* top header */}
      <div className="sticky top-0 z-50 border-b border-blue-100/70 bg-white/70 backdrop-blur dark:border-blue-900/50 dark:bg-slate-950/60">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0 hover:opacity-90 transition-opacity">
            <div className="w-12 h-12 rounded-xl bg-white border-2 border-blue-200 shadow-md flex items-center justify-center overflow-hidden shrink-0 dark:bg-slate-900 dark:border-blue-900/60">
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
                MLOps Tool
              </div>
              <div className="text-xs text-slate-500 truncate dark:text-slate-300">
                Dataset labeling • Review • Training • Exports
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <NavItem to="/" label="Projects" />
            <NavItem to="/admin/users" label="Users" />
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            <div className="hidden md:block text-right">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {user?.name || "User"}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-300">{user?.email || ""}</div>
            </div>

            <button
              className="px-3 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors dark:bg-blue-600 dark:hover:bg-blue-500"
              onClick={() => logout?.()}
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      {/* page content */}
      <div className="max-w-7xl mx-auto px-5 py-6">
        <div className="bg-white/70 border border-blue-100/70 rounded-3xl shadow-sm p-5 md:p-6 dark:bg-slate-950/50 dark:border-blue-900/50">
          {children}
        </div>
      </div>
    </div>
  )
}
