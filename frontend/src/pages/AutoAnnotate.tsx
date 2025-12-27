// frontend/src/pages/AutoAnnotate.tsx
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api, wsJobUrl } from "../api"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type ASet = { id: number; name: string; source: string }
type LabelClass = { id: number; name: string; color: string; order_index: number }

type Job = { id: number; status: string; progress: number; message: string; updated_at: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 p-5 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  label: "text-xs font-medium text-blue-700 dark:text-blue-200",
  input:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  select:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "rounded-xl px-4 py-2.5 font-medium text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "rounded-xl px-4 py-2 font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  badge:
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium border-blue-200/70 bg-blue-50/80 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
}

export default function AutoAnnotate() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [sets, setSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [loading, setLoading] = useState(false)

  const [datasetId, setDatasetId] = useState<number>(0)
  const [modelId, setModelId] = useState<number>(0)

  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.45)

  // mapping: model_class_name -> project_class_name
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // websocket job
  const [job, setJob] = useState<Job | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const selectedModel = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId])

  const modelClassNames = useMemo(() => {
    if (!selectedModel) return []
    const entries = Object.entries(selectedModel.class_names || {})
      .map(([k, v]) => ({ idx: Number(k), name: String(v) }))
      .sort((a, b) => a.idx - b.idx)
    return entries
  }, [selectedModel])

  async function refresh() {
    try {
      setLoading(true)
      const [d, m, s, c] = await Promise.all([
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/models`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
        api.get(`/api/projects/${projectId}/classes`),
      ])
      setDatasets(d.data)
      setModels(m.data)
      setSets(s.data)
      setClasses(c.data)

      if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
      if (!modelId && m.data.length) setModelId(m.data[0].id)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load data", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // initialize mapping defaults when model changes
  useEffect(() => {
    if (!selectedModel) return
    const next: Record<string, string> = {}
    for (const mc of modelClassNames) {
      const lower = mc.name.toLowerCase()
      const match = classes.find((c) => c.name.toLowerCase() === lower)
      next[mc.name] = match ? match.name : ""
    }
    setMapping(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, classes.length])

  function setMap(modelName: string, projectName: string) {
    setMapping((m) => ({ ...m, [modelName]: projectName }))
  }

  function connectJobWS(jobId: number) {
    try {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      const ws = new WebSocket(wsJobUrl(jobId))
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.error) {
            showToast(data.error, "error")
            return
          }
          setJob(data)
          if (data.status === "success" || data.status === "done") {
            showToast("Auto-annotation completed successfully", "success")
            ws.close()
            wsRef.current = null
          } else if (data.status === "failed") {
            showToast(`Job failed: ${data.message || "Unknown error"}`, "error")
            ws.close()
            wsRef.current = null
          }
        } catch {}
      }
    } catch {}
  }

  async function start() {
    if (!datasetId || !modelId) {
      showToast("Please select a dataset and model", "error")
      return
    }

    const class_mapping: Record<string, string> = {}
    for (const [k, v] of Object.entries(mapping)) {
      if (v && v.trim()) class_mapping[k] = v.trim()
    }

    const payload = {
      model_id: modelId,
      dataset_id: datasetId,
      annotation_set_id: null,
      conf,
      iou,
      device: "",
      params: { class_mapping },
    }

    try {
      const r = await api.post(`/api/projects/${projectId}/jobs/auto-annotate`, payload)
      const jobId = r.data.id || r.data.job_id
      if (!jobId) {
        showToast("Job started but no job_id returned", "error")
        return
      }
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        message: "Starting…",
        updated_at: new Date().toISOString(),
      })
      showToast("Auto-annotation job started", "success")
      connectJobWS(jobId)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to start job", "error")
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className={UI.h1}>Auto-annotate</div>
          <div className={UI.sub}>
            Map model classes to project labels, run an async job, and watch progress live.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
              Back to project
            </Link>
            <Link to={`/project/${projectId}/view-auto`} className={UI.btnSecondary}>
              View auto-annotations
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={UI.badge}>Project ID {projectId}</span>
          {sets?.length ? <span className={UI.badge}>{sets.length} annotation set(s)</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <div className={UI.card}>
          <div className="font-semibold text-slate-900 dark:text-slate-100">Inputs</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className={UI.label}>Dataset</div>
              <select className={UI.select} value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dataset {d.id}: {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className={UI.label}>Model</div>
              <select className={UI.select} value={modelId} onChange={(e) => setModelId(Number(e.target.value))}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    Model {m.id}: {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className={UI.label}>Confidence</div>
              <input
                className={UI.input}
                type="number"
                step="0.01"
                value={conf}
                onChange={(e) => setConf(Number(e.target.value))}
              />
            </div>

            <div>
              <div className={UI.label}>IoU</div>
              <input
                className={UI.input}
                type="number"
                step="0.01"
                value={iou}
                onChange={(e) => setIou(Number(e.target.value))}
              />
            </div>
          </div>

          <button
            className={cx(UI.btnPrimary, "mt-4")}
            onClick={start}
            disabled={loading || !datasetId || !modelId || job?.status === "running"}
          >
            {job?.status === "running" ? "Running…" : "Start auto-annotation"}
          </button>

          {job && (
            <div className="mt-4 rounded-2xl border border-blue-100/70 bg-white/70 p-4 dark:border-blue-900/50 dark:bg-slate-950/30">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-slate-900 dark:text-slate-100">Job #{job.id}</div>
                <span
                  className={cx(
                    "rounded-full px-2.5 py-1 text-xs font-medium border",
                    job.status === "success" || job.status === "done"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50"
                      : job.status === "failed"
                      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/50"
                      : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60"
                  )}
                >
                  {String(job.status || "Queued")}
                </span>
              </div>

              <div className="text-sm text-slate-700 dark:text-slate-200 mt-2">{job.message || "—"}</div>

              <div className="mt-3">
                <div className="h-2 rounded-full overflow-hidden bg-blue-100 dark:bg-blue-950/40">
                  <div
                    className="h-2 bg-blue-600 dark:bg-sky-600 transition-all"
                    style={{ width: `${Math.round((job.progress || 0) * 100)}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-blue-700 dark:text-blue-200 font-medium">
                  {Math.round((job.progress || 0) * 100)}%
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={UI.card}>
          <div className="font-semibold text-slate-900 dark:text-slate-100">Class mapping</div>
          <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            Only mapped classes are saved. Unmapped predictions are ignored.
          </div>

          <div className="mt-4 grid gap-2 max-h-[560px] overflow-auto pr-1">
            {modelClassNames.length === 0 && (
              <div className="rounded-2xl border border-blue-100/70 bg-blue-50/60 p-4 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                The selected model has no readable class names.
              </div>
            )}

            {modelClassNames.map((mc) => (
              <div
                key={mc.idx}
                className="rounded-2xl border border-blue-100/70 bg-white/70 p-4 flex items-center justify-between gap-3 hover:bg-blue-50/40 transition-colors dark:border-blue-900/50 dark:bg-slate-950/30 dark:hover:bg-blue-950/30"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{mc.name}</div>
                  <div className="text-xs text-blue-700 dark:text-blue-200 mt-1">Model class {mc.idx}</div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-blue-500 dark:text-blue-300">→</div>
                  <select
                    className={cx(UI.select, "min-w-[180px]")}
                    value={mapping[mc.name] || ""}
                    onChange={(e) => setMap(mc.name, e.target.value)}
                  >
                    <option value="">Ignore</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-100/70 bg-blue-50/60 p-3 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
            Tip: Keep project class names aligned with your model labels to reduce manual mapping.
          </div>
        </div>
      </div>
    </div>
  )
}
