import React, { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { API_BASE, api, wsJobUrl, jobTrainYoloArtifactUrl } from "../api"
import { useToast } from "../components/Toast"
import PageHeader from "../components/PageHeader"

type Dataset = { id: number; name: string }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type ASet = { id: number; name: string; source: string }
type Job = { id: number; status: string; progress: number; message: string; updated_at: string }

type LiveCsv = { columns: string[]; rows: string[][]; job_rel_path?: string | null; updated_at?: string }

type TrainSummary = {
  job_id: number
  status: string
  progress: number
  message: string
  trained_model_id?: number | null
  trained_model_name?: string | null
  metrics?: Record<string, any> | null
  downloads?: Array<{ label: string; job_rel_path: string; url: string }>
  plots?: Array<{ name: string; job_rel_path: string; url: string }>
  updated_at?: string | null
}

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  field:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 " +
    "focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 " +
    "dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 " +
    "dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  textarea: "min-h-[96px] resize-y",
  label: "text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1",
  helper: "text-[11px] text-slate-600 dark:text-slate-300 mt-1",
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className={UI.label}>{children}</div>
}

function pickColumns(all: string[]) {
  const preferred = [
    "epoch",
    "metrics/mAP50(B)",
    "metrics/mAP50-95(B)",
    "metrics/precision(B)",
    "metrics/recall(B)",
    "train/box_loss",
    "train/cls_loss",
    "train/dfl_loss",
    "val/box_loss",
    "val/cls_loss",
    "val/dfl_loss",
  ]
  const picked = preferred.filter((c) => all.includes(c))
  if (picked.length >= 6) return picked.slice(0, 6)
  return all.slice(0, 6)
}

export default function TrainYolo() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [sets, setSets] = useState<ASet[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [annotationSetId, setAnnotationSetId] = useState<number>(0)
  const [baseModelId, setBaseModelId] = useState<number>(0)

  const [trainedModelName, setTrainedModelName] = useState("trained_model")
  const [metaJson, setMetaJson] = useState<string>("{}")

  const [splitMode, setSplitMode] = useState<"keep" | "random">("keep")
  const [trainRatio, setTrainRatio] = useState(0.8)
  const [valRatio, setValRatio] = useState(0.1)
  const [testRatio, setTestRatio] = useState(0.1)
  const [seed, setSeed] = useState(1337)

  const [imgsz, setImgsz] = useState(640)
  const [epochs, setEpochs] = useState(50)
  const [batch, setBatch] = useState(16)
  const [device, setDevice] = useState("0")
  const [workers, setWorkers] = useState(4)
  const [optimizer, setOptimizer] = useState<"SGD" | "Adam" | "AdamW">("SGD")
  const [approvedOnly, setApprovedOnly] = useState(true)

  const [benchSplit, setBenchSplit] = useState<"test" | "val">("test")
  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.7)

  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [liveCsv, setLiveCsv] = useState<LiveCsv | null>(null)
  const [summary, setSummary] = useState<TrainSummary | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<number | null>(null)

  async function refresh() {
    try {
      setLoading(true)
      const [d, m, s] = await Promise.all([
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/models`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
      ])
      setDatasets(d.data || [])
      setModels(m.data || [])
      setSets(s.data || [])

      if (!datasetId && (d.data || []).length) setDatasetId(d.data[0].id)
      if (!annotationSetId && (s.data || []).length) setAnnotationSetId(s.data[0].id)
      if (!baseModelId && (m.data || []).length) setBaseModelId(m.data[0].id)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load training inputs.", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  function connectJobWS(jobId: number) {
    try {
      if (wsRef.current) wsRef.current.close()
      const ws = new WebSocket(wsJobUrl(jobId))
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          setJob(data)
          if (data.status === "success" || data.status === "done") {
            showToast("Training completed successfully.", "success")
            ws.close()
            wsRef.current = null
            fetchSummary(jobId)
          } else if (data.status === "failed") {
            showToast(`Training failed: ${data.message || "Unknown error"}`, "error")
            ws.close()
            wsRef.current = null
          }
        } catch {}
      }
    } catch {}
  }

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function startPolling(jobId: number) {
    stopPolling()
    pollRef.current = window.setInterval(() => {
      fetchJob(jobId)
      fetchLiveCsv(jobId)
    }, 2000)
  }

  async function fetchJob(jobId: number) {
    try {
      const r = await api.get(`/api/jobs/${jobId}`)
      setJob(r.data)
    } catch {}
  }

  async function fetchLiveCsv(jobId: number) {
    try {
      const r = await api.get(`/api/jobs/${jobId}/train-yolo/live-csv`, { params: { limit: 20 } })
      setLiveCsv(r.data)
    } catch {}
  }

  async function fetchSummary(jobId: number) {
    try {
      const r = await api.get(`/api/jobs/${jobId}/train-yolo/summary`)
      setSummary(r.data)
    } catch {}
  }

  function parseMeta(): Record<string, any> {
    const raw = (metaJson || "").trim()
    if (!raw) return {}
    try {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj
      showToast('Metadata must be a JSON object (e.g. {"team":"essi"}).', "error")
      throw new Error("meta not object")
    } catch (e: any) {
      showToast("Invalid metadata JSON. Fix it before starting.", "error")
      throw e
    }
  }

  async function start() {
    if (!datasetId || !annotationSetId || !baseModelId) {
      showToast("Select a dataset, annotation set, and base model.", "error")
      return
    }
    const name = (trainedModelName || "").trim()
    if (!name) {
      showToast("Enter a trained model name.", "error")
      return
    }
    if (splitMode === "random") {
      const sum = trainRatio + valRatio + testRatio
      if (Math.abs(sum - 1.0) > 1e-6) {
        showToast("Split ratios must sum to 1.0.", "error")
        return
      }
    }

    let meta: Record<string, any> = {}
    try {
      meta = parseMeta()
    } catch {
      return
    }

    setSummary(null)
    setLiveCsv(null)

    const payload = {
      dataset_id: datasetId,
      annotation_set_id: annotationSetId,
      base_model_id: baseModelId,
      trained_model_name: name,

      split_mode: splitMode,
      train_ratio: trainRatio,
      val_ratio: valRatio,
      test_ratio: testRatio,
      seed,

      imgsz,
      epochs,
      batch,
      device,
      workers,
      optimizer,
      cos_lr: true,
      patience: 20,
      cache: "disk",

      approved_only: approvedOnly,

      bench_split: benchSplit,
      conf,
      iou,

      meta,
    }

    try {
      const r = await api.post(`/api/projects/${projectId}/jobs/train-yolo`, payload)
      const jobId = r.data.id || r.data.job_id
      if (!jobId) {
        showToast("Job started, but no job_id returned.", "error")
        return
      }
      setJob({ id: jobId, status: "queued", progress: 0, message: "Starting…", updated_at: new Date().toISOString() })
      showToast("Training job started.", "success")
      connectJobWS(jobId)
      startPolling(jobId)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to start training job.", "error")
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
      stopPolling()
    }
  }, [])

  useEffect(() => {
    const s = (job?.status || "").toLowerCase()
    if (!job?.id) return
    if (s === "running" || s === "queued") return
    stopPolling()
  }, [job?.status, job?.id])

  function statusBadge(status: string) {
    const s = (status || "").toLowerCase()
    if (s === "success" || s === "done") return "badge badge-green"
    if (s === "failed" || s === "error") return "badge badge-red"
    if (s === "running") return "badge badge-blue"
    return "badge"
  }

  const liveColumns = useMemo(() => pickColumns(liveCsv?.columns || []), [liveCsv?.columns])
  const liveColIdx = useMemo(() => {
    const map = new Map<string, number>()
    ;(liveCsv?.columns || []).forEach((c, i) => map.set(c, i))
    return map
  }, [liveCsv?.columns])

  const isActive = useMemo(() => {
    const s = (job?.status || "").toLowerCase()
    return s === "running" || s === "queued"
  }, [job?.status])

  return (
    <div>
      <PageHeader
        title="Train YOLO"
        subtitle="Fine-tune a base model from validated annotations and benchmark it."
        projectId={projectId}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/project/${projectId}`} className="btn btn-ghost text-sm">
              Back to Project
            </Link>
            <button className="btn btn-primary text-sm" onClick={start} disabled={loading || !datasetId || !annotationSetId || !baseModelId || isActive}>
              {isActive ? "Running…" : "Start training"}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="app-card p-5">
          <div className="font-semibold">Inputs</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Dataset</FieldLabel>
              <select className={UI.field} value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dataset {d.id}: {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>Annotation set</FieldLabel>
              <select className={UI.field} value={annotationSetId} onChange={(e) => setAnnotationSetId(Number(e.target.value))}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    Set {s.id}: {s.name} ({s.source})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <FieldLabel>Trained model name</FieldLabel>
              <input
                className={UI.field}
                value={trainedModelName}
                onChange={(e) => setTrainedModelName(e.target.value)}
                placeholder="e.g. essi_vehicle_v1"
              />
              <div className={UI.helper}>
                This name will appear in <span className="font-semibold">Models</span> after training.
              </div>
            </div>

            <div className="md:col-span-2">
              <FieldLabel>Metadata (JSON)</FieldLabel>
              <textarea
                className={cx(UI.field, UI.textarea)}
                value={metaJson}
                onChange={(e) => setMetaJson(e.target.value)}
                placeholder='{"site":"J&K","camera":"axis-m1125","notes":"baseline run"}'
              />
              <div className={UI.helper}>
                Optional. This will be embedded into the trained <span className="font-semibold">.pt</span> and stored in DB meta.
              </div>
            </div>

            <div className="md:col-span-2">
              <FieldLabel>Base model</FieldLabel>
              <select className={UI.field} value={baseModelId} onChange={(e) => setBaseModelId(Number(e.target.value))}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    Model {m.id}: {m.name}
                  </option>
                ))}
              </select>
              <div className={UI.helper}>
                Tip: Upload a YOLO detection <span className="font-semibold">.pt</span> under Models first.
              </div>
            </div>

            <div className="md:col-span-2 mt-2 border-t border-[color:var(--border)] pt-3">
              <div className="font-semibold">Split</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <select className={UI.field} value={splitMode} onChange={(e) => setSplitMode(e.target.value as any)}>
                  <option value="keep">Keep existing</option>
                  <option value="random">Random</option>
                </select>

                <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input className="accent-blue-600" type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
                  Approved only
                </label>
              </div>

              {splitMode === "random" && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <FieldLabel>Train</FieldLabel>
                    <input className={UI.field} type="number" step="0.01" value={trainRatio} onChange={(e) => setTrainRatio(Number(e.target.value))} />
                  </div>
                  <div>
                    <FieldLabel>Val</FieldLabel>
                    <input className={UI.field} type="number" step="0.01" value={valRatio} onChange={(e) => setValRatio(Number(e.target.value))} />
                  </div>
                  <div>
                    <FieldLabel>Test</FieldLabel>
                    <input className={UI.field} type="number" step="0.01" value={testRatio} onChange={(e) => setTestRatio(Number(e.target.value))} />
                  </div>
                  <div>
                    <FieldLabel>Seed</FieldLabel>
                    <input className={UI.field} type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-2 mt-2 border-t border-[color:var(--border)] pt-3">
              <div className="font-semibold">Training</div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <FieldLabel>Image size</FieldLabel>
                  <input className={UI.field} type="number" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
                </div>
                <div>
                  <FieldLabel>Epochs</FieldLabel>
                  <input className={UI.field} type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
                </div>
                <div>
                  <FieldLabel>Batch</FieldLabel>
                  <input className={UI.field} type="number" value={batch} onChange={(e) => setBatch(Number(e.target.value))} />
                </div>
                <div>
                  <FieldLabel>Device</FieldLabel>
                  <input className={UI.field} value={device} onChange={(e) => setDevice(e.target.value)} placeholder="cpu or 0" />
                </div>
                <div>
                  <FieldLabel>Workers</FieldLabel>
                  <input className={UI.field} type="number" value={workers} onChange={(e) => setWorkers(Number(e.target.value))} />
                </div>
                <div>
                  <FieldLabel>Optimizer</FieldLabel>
                  <select className={UI.field} value={optimizer} onChange={(e) => setOptimizer(e.target.value as any)}>
                    <option value="SGD">SGD</option>
                    <option value="Adam">Adam</option>
                    <option value="AdamW">AdamW</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 mt-2 border-t border-[color:var(--border)] pt-3">
              <div className="font-semibold">Benchmark</div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <FieldLabel>Split</FieldLabel>
                  <select className={UI.field} value={benchSplit} onChange={(e) => setBenchSplit(e.target.value as any)}>
                    <option value="test">Test</option>
                    <option value="val">Val</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Confidence</FieldLabel>
                  <input className={UI.field} type="number" step="0.01" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
                </div>
                <div>
                  <FieldLabel>IoU</FieldLabel>
                  <input className={UI.field} type="number" step="0.01" value={iou} onChange={(e) => setIou(Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>

          {/* Job card */}
          {job && (
            <div className="mt-4 rounded-2xl p-4 border border-[color:var(--border)] bg-[rgba(59,130,246,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">Job #{job.id}</div>
                <span className={statusBadge(job.status)}>{job.status}</span>
              </div>

              <div className="text-xs opacity-75 mt-2">{job.message || "—"}</div>

              <div className="mt-3">
                <div className="h-2 rounded-full overflow-hidden bg-[rgba(59,130,246,0.18)]">
                  <div className="h-2 bg-blue-600 transition-all" style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
                </div>
                <div className="text-xs opacity-75 mt-1">{Math.round((job.progress || 0) * 100)}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Outputs */}
        <div className="app-card p-5">
          <div className="font-semibold">Outputs</div>
          <div className="text-sm opacity-80 mt-1">
            Live training updates come from <span className="font-semibold">results.csv</span>, so users can see progress even if logs are quiet.
          </div>

          {/* Live CSV */}
          <div className="mt-4 rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-4 py-3 bg-[rgba(59,130,246,0.06)] flex items-center justify-between gap-3">
              <div className="font-semibold text-sm">Live training metrics</div>
              {job && <span className={statusBadge(job.status)}>{job.status}</span>}
            </div>

            <div className="p-4">
              {!job && <div className="text-sm opacity-75">Start a training job to see live metrics and downloadable artifacts.</div>}

              {job && (
                <div className="text-xs opacity-75 mb-3">
                  {liveCsv?.updated_at ? (
                    <>
                      Last update: <span className="font-semibold">{new Date(liveCsv.updated_at).toLocaleString()}</span>
                    </>
                  ) : (
                    "Waiting for first epoch…"
                  )}
                </div>
              )}

              {job && liveCsv?.rows?.length ? (
                <>
                  <div className="overflow-auto rounded-xl border border-[color:var(--border)]">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-[color:var(--card)]">
                        <tr className="border-b border-[color:var(--border)]">
                          {liveColumns.map((c) => (
                            <th key={c} className="text-left px-3 py-2 font-semibold opacity-80 whitespace-nowrap">
                              {c === "epoch" ? "epoch" : c.split("/").slice(-1)[0]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {liveCsv.rows.slice(-10).map((row, i) => (
                          <tr key={i} className={cx("border-b border-[color:var(--border)]", i % 2 === 0 && "bg-[rgba(59,130,246,0.03)]")}>
                            {liveColumns.map((c) => {
                              const idx = liveColIdx.get(c) ?? -1
                              let v = idx >= 0 ? row[idx] : ""
                              if (c === "epoch" && v !== "") {
                                const n = Number(v)
                                if (!Number.isNaN(n)) v = String(n + 1)
                              }
                              return (
                                <td key={c} className="px-3 py-2 whitespace-nowrap">
                                  {v || "—"}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {job.id && liveCsv.job_rel_path && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <a className="btn btn-ghost text-sm" href={jobTrainYoloArtifactUrl(job.id, liveCsv.job_rel_path)} target="_blank" rel="noreferrer">
                        Open full results.csv
                      </a>
                    </div>
                  )}
                </>
              ) : job ? (
                <div className="text-sm opacity-75">Waiting for results.csv… (it usually appears after the first epoch)</div>
              ) : null}
            </div>
          </div>

          {/* Summary */}
          {summary && (summary.downloads?.length || summary.plots?.length || summary.metrics) ? (
            <div className="mt-4">
              <div className="font-semibold text-sm">Training results</div>

              {summary.metrics && (
                <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {[
                    ["Precision", summary.metrics["precision(B)"] ?? summary.metrics["precision"]],
                    ["Recall", summary.metrics["recall(B)"] ?? summary.metrics["recall"]],
                    ["mAP50", summary.metrics["mAP50(B)"] ?? summary.metrics["mAP50"] ?? summary.metrics["map50"]],
                    ["mAP50-95", summary.metrics["mAP50-95(B)"] ?? summary.metrics["mAP50-95"] ?? summary.metrics["map5095"]],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-[color:var(--border)] p-3 bg-[rgba(59,130,246,0.04)]">
                      <div className="text-[11px] font-semibold opacity-80">{k}</div>
                      <div className="text-lg font-semibold mt-1">{typeof v === "number" ? v.toFixed(4) : v ?? "—"}</div>
                    </div>
                  ))}
                </div>
              )}

              {summary.downloads?.length ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold opacity-80 mb-2">Downloads</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {summary.downloads.map((d) => (
                      <a key={d.url} className="btn btn-primary text-sm" href={`${API_BASE}${d.url}`} target="_blank" rel="noreferrer">
                        {d.label}
                      </a>
                    ))}
                    <Link to={`/project/${projectId}/models`} className="btn btn-ghost text-sm">
                      Open Models
                    </Link>
                  </div>
                </div>
              ) : null}

              {summary.plots?.length ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold opacity-80 mb-2">Plots</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {summary.plots.slice(0, 6).map((p) => (
                      <a
                        key={p.url}
                        className="rounded-2xl border border-[color:var(--border)] overflow-hidden bg-[color:var(--card)] hover:opacity-95 transition"
                        href={`${API_BASE}${p.url}`}
                        target="_blank"
                        rel="noreferrer"
                        title={p.name}
                      >
                        <img src={`${API_BASE}${p.url}`} alt={p.name} className="w-full h-32 object-cover" />
                        <div className="px-3 py-2 text-xs font-semibold opacity-80 truncate">{p.name}</div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 text-sm opacity-80">
              After success, the trained model will appear in your <span className="font-semibold">Models</span> list, and you can download artifacts here.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
