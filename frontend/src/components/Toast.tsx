import React, { createContext, useContext, useState, useCallback } from "react"

type Toast = {
  id: string
  message: string
  type: "success" | "error" | "info"
}

type ToastContextType = {
  showToast: (message: string, type?: "success" | "error" | "info") => void
}

const ToastContext = createContext<ToastContextType | null>(null)

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

function Icon({ type }: { type: Toast["type"] }) {
  const common = "w-4 h-4"
  if (type === "success")
    return (
      <svg className={common} viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 111.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
          clipRule="evenodd"
        />
      </svg>
    )
  if (type === "error")
    return (
      <svg className={common} viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm2.707-10.707a1 1 0 00-1.414-1.414L10 7.172 8.707 5.879A1 1 0 007.293 7.293L8.586 8.586 7.293 9.879a1 1 0 101.414 1.414L10 10l1.293 1.293a1 1 0 001.414-1.414L11.414 8.586l1.293-1.293z"
          clipRule="evenodd"
        />
      </svg>
    )
  return (
    <svg className={common} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-8-3a1 1 0 100 2 1 1 0 000-2zm1 8a1 1 0 10-2 0v-4a1 1 0 102 0v4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      const id = Math.random().toString(36).substr(2, 9)
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3200)
    },
    []
  )

  const remove = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
        {toasts.map((toast) => {
          const tone =
            toast.type === "success"
              ? { ring: "ring-emerald-200/60", border: "border-emerald-200/70", accent: "text-emerald-700" }
              : toast.type === "error"
              ? { ring: "ring-red-200/60", border: "border-red-200/70", accent: "text-red-700" }
              : { ring: "ring-blue-200/60", border: "border-blue-200/70", accent: "text-blue-700" }

          return (
            <div
              key={toast.id}
              className={cx(
                "min-w-[320px] max-w-[420px]",
                "rounded-2xl border bg-white/85 backdrop-blur shadow-lg",
                "ring-1",
                tone.ring,
                tone.border
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <div className={cx("mt-0.5", tone.accent)}>
                  <Icon type={toast.type} />
                </div>

                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-900 leading-snug">{toast.message}</div>
                </div>

                <button
                  className="text-slate-400 hover:text-slate-700 transition-colors"
                  onClick={() => remove(toast.id)}
                  aria-label="close toast"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}
