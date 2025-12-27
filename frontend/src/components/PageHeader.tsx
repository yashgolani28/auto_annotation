import React from "react"
import { Link } from "react-router-dom"

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

export default function PageHeader({
  title,
  subtitle,
  projectId,
  right,
  backToProjects = false,
}: {
  title: string
  subtitle?: string
  projectId?: number | null
  right?: React.ReactNode
  backToProjects?: boolean
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-2xl md:text-[26px] font-semibold">{title}</div>

          {typeof projectId === "number" && projectId > 0 && (
            <Link
              to={`/project/${projectId}`}
              className={cx(
                "inline-flex items-center gap-2",
                "rounded-xl px-3 py-1.5 text-sm font-medium",
                "border border-blue-200/70 bg-white/70 hover:bg-white transition-colors",
                "text-blue-700",
                "dark:border-blue-900/60 dark:bg-slate-900/60 dark:hover:bg-slate-900/80 dark:text-blue-200"
              )}
              title="Go back to project"
            >
              <span aria-hidden>←</span>
              Back to project
            </Link>
          )}

          {backToProjects && (
            <Link
              to="/"
              className={cx(
                "inline-flex items-center gap-2",
                "rounded-xl px-3 py-1.5 text-sm font-medium",
                "border border-blue-200/70 bg-white/70 hover:bg-white transition-colors",
                "text-blue-700",
                "dark:border-blue-900/60 dark:bg-slate-900/60 dark:hover:bg-slate-900/80 dark:text-blue-200"
              )}
              title="Go back to projects"
            >
              <span aria-hidden>←</span>
              Back to projects
            </Link>
          )}
        </div>

        {subtitle ? <div className="mt-1 text-sm muted">{subtitle}</div> : null}
      </div>

      {right ? <div className="flex items-center gap-2 flex-wrap justify-start md:justify-end">{right}</div> : null}
    </div>
  )
}
