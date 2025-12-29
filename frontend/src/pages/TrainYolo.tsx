import React, { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, wsJobUrl } from "../api"
import { useToast } from "../components/Toast"
import PageHeader from "../components/PageHeader"

type Dataset = { id: number; name: string }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type ASet = { id: number; name: string; source: string }
type Job = { id: number; status: string; progress: number; message: string; updated_at: string }

type TrainResults = {
  job_id: number
  run_name: string
  csv_rel_path: string
  headers: string[]
  rows: Array<Record<string, string>>
  updated_at_utc?: string | null
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
  textarea: "min-h-[90px] resize-y",
  sectionTitle: "font-semibold text-slate-900 dark:text-slate-100",
  helper: "text-[11px] text-slate-600 dark:text-slate-300 mt-1",
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{children}</div>
}

function statusBadge(status: string) {
  const s = (status || "").toLowerCase()
  if (s === "success" || s === "done") return "badge badge-green"
  if (s === "failed" || s === "error") return "badge badge-red"
  return "badge"
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
  const [device, setDevice] = useState("0") // "cpu" or "0"
  const [workers, setWorkers] = useState(4)
  const [optimizer, setOptimizer] = useState<"SGD" | "Adam" | "AdamW">("SGD")
  const [approvedOnly, setApprovedOnly] = useState(true)

  const [benchSplit, setBenchSplit] = useState<"test" | "val">("test")
  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.7)

  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // live results.csv tail
  const [trainResults, setTrainResults] = useState<TrainResults | null>(null)
  const [trainResultsError, setTrainResultsError] = useState<string>("")

  const isRunning = (job?.status || "").toLowerCase() === "running"

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
          } else if (data.status === "failed") {
            showToast(`Training failed: ${data.message || "Unknown error"}`, "error")
            ws.close()
            wsRef.current = null
          }
        } catch {}
      }
    } catch {}
  }

  function parseMeta(): Record<string, any> {
    const raw = (metaJson || "").trim()
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj
    showToast('Metadata must be a JSON object (e.g. {"team":"essi"}).', "error")
    throw new Error("meta not object")
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
      showToast("Invalid metadata JSON. Fix it before starting.", "error")
      return
    }

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
      setTrainResults(null)
      setTrainResultsError("")
      showToast("Training job started.", "success")
      connectJobWS(jobId)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to start training job.", "error")
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // poll results.csv tail while running
  useEffect(() => {
    const jid = job?.id
    if (!jid || !isRunning) {
      setTrainResults(null)
      setTrainResultsError("")
      return
    }

    let alive = true

    async function tick() {
      try {
        const r = await api.get(`/api/jobs/${jid}/train-results`, { params: { tail: 12 } })
        if (!alive) return
        setTrainResults(r.data)
        setTrainResultsError("")
      } catch (err: any) {
        if (!alive) return
        const code = err?.response?.status
        if (code === 404) {
          // results.csv may not exist yet for the first epoch
          setTrainResults(null)
          setTrainResultsError("")
          return
        }
        setTrainResultsError(err?.response?.data?.detail || "Failed to fetch live training results.")
      }
    }

    tick()
    const t = window.setInterval(tick, 2500)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [job?.id, isRunning])

  const liveCols = useMemo(() => {
    const hdr = trainResults?.headers || []
    const preferred = [
      "epoch",
      "train/box_loss",
      "train/cls_loss",
      "train/dfl_loss",
      "metrics/precision(B)",
      "metrics/recall(B)",
      "metrics/mAP50(B)",
      "metrics/mAP50-95(B)",
      "lr/pg0",
    ]
    const picked = hdr.filter((c) => preferred.includes(c))
    return picked.length ? picked : hdr.slice(0, 8)
  }, [trainResults?.headers])

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
            <button
              className="btn btn-primary text-sm"
              onClick={start}
              disabled={loading || !datasetId || !annotationSetId || !baseModelId || isRunning}
            >
              {isRunning ? "Running…" : "Start training"}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="app-card p-5">
          <div className={UI.sectionTitle}>Inputs</div>

          {(datasets.length === 0 || sets.length === 0 || models.length === 0) && (
            <div className="mt-3 text-sm text-slate-700 dark:text-slate-300">
              {datasets.length === 0 && <div>• No datasets found for this project.</div>}
              {sets.length === 0 && <div>• No annotation sets found for this project.</div>}
              {models.length === 0 && <div>• No base models found. Upload a YOLO .pt under Models first.</div>}
            </div>
          )}

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
                This name will be used when exporting your trained model and benchmark report.
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
              <div className={UI.helper}>Optional. Stored in DB and included in the trained model meta.</div>
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
              <div className={UI.helper}>Upload a YOLO detection .pt under Models if this list is empty.</div>
            </div>

            <div className="md:col-span-2 mt-2 border-t border-[color:var(--border)] pt-3">
              <div className={UI.sectionTitle}>Split</div>
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
              <div className={UI.sectionTitle}>Training</div>
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
              <div className={UI.sectionTitle}>Benchmark</div>
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

          {job && (
            <div className="mt-4 rounded-2xl p-4 border border-[color:var(--border)] bg-[rgba(59,130,246,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900 dark:text-slate-100">Job #{job.id}</div>
                <span className={statusBadge(job.status)}>{job.status}</span>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300 mt-2">{job.message || "—"}</div>

              <div className="mt-3">
                <div className="h-2 rounded-full overflow-hidden bg-[rgba(59,130,246,0.18)]">
                  <div className="h-2 bg-blue-600 transition-all" style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{Math.round((job.progress || 0) * 100)}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Outputs */}
        <div className="app-card p-5">
          <div className={UI.sectionTitle}>Outputs</div>
          <div className="text-sm text-slate-700 dark:text-slate-300 mt-1">
            Live training updates come from results.csv, so users can see progress even if logs are quiet.
          </div>

          <div className="mt-4 rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between gap-3 bg-[rgba(59,130,246,0.06)]">
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">Live training metrics</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {trainResults?.updated_at_utc ? `Updated (UTC): ${trainResults.updated_at_utc}` : isRunning ? "Waiting for results…" : "—"}
              </div>
            </div>

            <div className="p-4">
              {trainResultsError && <div className="text-sm text-red-500 mb-2">{trainResultsError}</div>}
              {!trainResults && !trainResultsError && (
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  {isRunning ? "No results yet. This usually appears after the first epoch." : "Start a training job to see live metrics and downloadable artifacts."}
                </div>
              )}

              {trainResults && (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        {liveCols.map((c) => (
                          <th key={c} className="py-2 pr-3 font-semibold whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-slate-800 dark:text-slate-100">
                      {trainResults.rows.map((r, idx) => (
                        <tr key={idx} className="border-t border-[color:var(--border)]">
                          {liveCols.map((c) => (
                            <td key={c} className="py-2 pr-3 whitespace-nowrap">
                              {(r as any)[c] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {trainResults.csv_rel_path && (
                    <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                      Source: <span className="font-mono">{trainResults.csv_rel_path}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 text-sm text-slate-700 dark:text-slate-300">
            After success, the trained model will appear in your <span className="font-semibold">Models</span> list and can be downloaded from <span className="font-semibold">Exports</span>.
          </div>
        </div>
      </div>
    </div>
  )
}
