import React, { createContext, useContext, useEffect, useMemo, useState } from "react"

type Theme = "light" | "dark"
type ThemeCtx = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx | null>(null)

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light"
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyThemeClass(theme: Theme) {
  const root = document.documentElement
  if (theme === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("MLOps_theme") as Theme | null
      if (saved === "light" || saved === "dark") return saved
    } catch {}
    return getSystemTheme()
  })

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem("MLOps_theme", t)
    } catch {}
  }

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark")

  useEffect(() => {
    applyThemeClass(theme)
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
