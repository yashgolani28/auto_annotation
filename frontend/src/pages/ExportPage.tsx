import React, { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, API_BASE } from "../api"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type Export = { id: number; fmt: string }

type TrainedModel = {
  id: number
  name: string
  framework: string
  trained_at?: string | null
  metrics?: Record<string, any> | null
  has_model: boolean
  has_report: boolean

  // optional (if backend includes it)
  check_ok?: boolean | null
  check_summary?: string | null
}

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 p-6 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  label: "text-xs font-medium text-blue-700 dark:text-blue-200 mb-1 block",
  input:
    "rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  select:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "rounded-xl px-6 py-2.5 font-medium text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "rounded-xl px-4 py-2 font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  btnGood:
    "rounded-xl px-6 py-2.5 font-medium text-white transition-colors bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
  btnIndigo:
    "rounded-xl px-6 py-2.5 font-medium text-white transition-colors bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500",
  pillOk: "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  pillBad: "inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  pillNeutral: "inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
}

function metricPick(metrics: Record<string, any> | null | undefined) {
  if (!metrics) return null
  const p = metrics["precision(B)"] ?? metrics["precision"]
  const r = metrics["recall(B)"] ?? metrics["recall"]
  const m50 = metrics["mAP50(B)"] ?? metrics["mAP50"] ?? metrics["map50"]
  const m5095 = metrics["mAP50-95(B)"] ?? metrics["mAP50-95"] ?? metrics["map5095"]
  return { p, r, m50, m5095 }
}

function pillForOk(ok: any) {
  if (ok === true) return UI.pillOk
  if (ok === false) return UI.pillBad
  return UI.pillNeutral
}

function labelForOk(ok: any) {
  if (ok === true) return "Pass"
  if (ok === false) return "Fail"
  return "—"
}

export default function ExportPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  // dataset exports
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [sets, setSets] = useState<ASet[]>([])
  const [datasetId, setDatasetId] = useState<number>(0)
  const [setId, setSetId] = useState<number>(0)
  const [includeImages, setIncludeImages] = useState(true)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [lastExport, setLastExport] = useState<Export | null>(null)
  const [exporting, setExporting] = useState(false)

  // trained models list
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([])
  const [trainedModelId, setTrainedModelId] = useState<number>(0)
  const [loadingModels, setLoadingModels] = useState(false)

  // model check
  const [modelCheck, setModelCheck] = useState<any | null>(null)
  const [checking, setChecking] = useState(false)

  const selectedModel = useMemo(
    () => trainedModels.find((m) => m.id === trainedModelId) || null,
    [trainedModels, trainedModelId]
  )

  async function refresh() {
    try {
      const [d, s] = await Promise.all([
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
      ])
      setDatasets(d.data)
      setSets(s.data)
      if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
      if (!setId && s.data.length) setSetId(s.data[0].id)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load export data", "error")
    }
  }

  async function refreshTrainedModels() {
    try {
      setLoadingModels(true)
      const r = await api.get(`/api/projects/${projectId}/trained-models`)
      const xs: TrainedModel[] = Array.isArray(r.data) ? r.data : []
      setTrainedModels(xs)
      if (!trainedModelId && xs.length) setTrainedModelId(xs[0].id)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load trained models", "error")
    } finally {
      setLoadingModels(false)
    }
  }

  async function fetchModelCheck(refreshFlag: boolean) {
    if (!projectId || !trainedModelId) return
    try {
      setChecking(true)
      // ✅ expects backend endpoint: GET /api/projects/:projectId/models/:modelId/check
      const r = await api.get(`/api/projects/${projectId}/models/${trainedModelId}/check`, {
        params: { refresh: refreshFlag, persist: false },
      })
      setModelCheck(r.data)
    } catch (err: any) {
      // non-fatal: endpoint may not exist yet
      setModelCheck(null)
      const msg =
        err?.response?.status === 404
          ? "Model check endpoint is not available yet."
          : err?.response?.data?.detail || "Failed to run model check."
      showToast(msg, "error")
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    refreshTrainedModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    setModelCheck(null)
    if (!trainedModelId) return
    // load cached check (if backend returns it)
    fetchModelCheck(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainedModelId])

  async function doExport(fmt: "yolo" | "coco") {
    if (!datasetId || !setId) {
      showToast("Please select a dataset and annotation set", "error")
      return
    }
    try {
      setExporting(true)
      const r = await api.post(`/api/projects/${projectId}/exports`, {
        dataset_id: datasetId,
        annotation_set_id: setId,
        fmt,
        include_images: includeImages,
        approved_only: approvedOnly,
      })
      setLastExport(r.data)
      showToast(`Export created (${fmt.toUpperCase()})`, "success")
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Export failed", "error")
    } finally {
      setExporting(false)
    }
  }

  function downloadExport() {
    if (!lastExport) return
    window.open(`${API_BASE}/api/exports/${lastExport.id}/download`, "_blank")
  }

  function downloadTrainedModel() {
    if (!trainedModelId) return
    window.open(`${API_BASE}/api/projects/${projectId}/trained-models/${trainedModelId}/download/model`, "_blank")
  }

  function downloadBenchmarkReport() {
    if (!trainedModelId) return
    window.open(`${API_BASE}/api/projects/${projectId}/trained-models/${trainedModelId}/download/report`, "_blank")
  }

  const picked = metricPick(selectedModel?.metrics)

  const checkOk = useMemo(() => {
    if (selectedModel && typeof selectedModel.check_ok !== "undefined") return selectedModel.check_ok
    if (modelCheck && typeof modelCheck.ok !== "undefined") return modelCheck.ok
    return null
  }, [selectedModel, modelCheck])

  const checkSummary = useMemo(() => {
    if (selectedModel?.check_summary) return selectedModel.check_summary
    if (modelCheck?.summary) return modelCheck.summary
    if (modelCheck?.error) return modelCheck.error
    return null
  }, [selectedModel, modelCheck])

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
        <div>
          <div className={UI.h1}>Exports</div>
          <div className={UI.sub}>Export annotations (YOLO / COCO) and trained model artifacts.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
              Back to project
            </Link>
          </div>
        </div>
      </div>

      {/* ✅ Symmetric two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dataset exports */}
        <div className={UI.card}>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">Annotation exports</div>
          <div className={UI.sub}>Export your annotations in YOLO or COCO format.</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <div>
              <label className={UI.label}>Dataset</label>
              <select className={UI.select} value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={UI.label}>Annotation set</label>
              <select className={UI.select} value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.source})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 mt-5">
            <label className="flex items-center gap-3 cursor-pointer text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm">Include images in export</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => setApprovedOnly(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm">Export only approved annotations</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mt-6">
            <button className={UI.btnPrimary} onClick={() => doExport("yolo")} disabled={exporting || !datasetId || !setId}>
              {exporting ? "Exporting…" : "Export YOLO"}
            </button>

            <button className={UI.btnPrimary} onClick={() => doExport("coco")} disabled={exporting || !datasetId || !setId}>
              {exporting ? "Exporting…" : "Export COCO"}
            </button>

            {lastExport && (
              <button className={UI.btnGood} onClick={downloadExport}>
                Download export
              </button>
            )}
          </div>

          {lastExport && (
            <div className="mt-6 rounded-2xl border border-blue-100/70 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Last export</div>
              <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                ID: {lastExport.id} • Format: {lastExport.fmt.toUpperCase()}
              </div>
            </div>
          )}
        </div>

        {/* Training artifacts + checks */}
        <div className={UI.card}>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">Training artifacts</div>
          <div className={UI.sub}>Select a trained model to download weights, reports, and verify compatibility.</div>

          <div className="mt-5">
            <label className={UI.label}>Trained model</label>
            <select
              className={UI.select}
              value={trainedModelId || ""}
              onChange={(e) => setTrainedModelId(Number(e.target.value))}
              disabled={loadingModels}
            >
              <option value="" disabled>
                {loadingModels ? "Loading models…" : trainedModels.length ? "Select a model" : "No trained models yet"}
              </option>
              {trainedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (id {m.id})
                </option>
              ))}
            </select>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button className={UI.btnSecondary} onClick={refreshTrainedModels} disabled={loadingModels}>
                {loadingModels ? "Refreshing…" : "Refresh list"}
              </button>

              <button className={UI.btnSecondary} onClick={() => fetchModelCheck(true)} disabled={!trainedModelId || checking}>
                {checking ? "Checking…" : "Run check"}
              </button>

              <button className={UI.btnGood} disabled={!selectedModel?.has_model} onClick={downloadTrainedModel}>
                Download model
              </button>

              <button className={UI.btnIndigo} disabled={!selectedModel?.has_report} onClick={downloadBenchmarkReport}>
                Download benchmark report
              </button>
            </div>
          </div>

          {selectedModel && (
            <div className="mt-5 rounded-2xl border border-blue-100/70 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedModel.name}</div>
                  <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                    Framework: {selectedModel.framework} • Trained at:{" "}
                    {selectedModel.trained_at ? new Date(selectedModel.trained_at).toLocaleString() : "—"}
                  </div>
                </div>

                <span className={pillForOk(checkOk)}>{labelForOk(checkOk)}</span>
              </div>

              {checkSummary && (
                <div className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">Check:</span> {checkSummary}
                </div>
              )}

              {picked ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
                  {[
                    ["Precision", picked.p],
                    ["Recall", picked.r],
                    ["mAP50", picked.m50],
                    ["mAP50-95", picked.m5095],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-xl border border-blue-100/70 bg-white/70 px-3 py-2 dark:border-blue-900/50 dark:bg-slate-950/40"
                    >
                      <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-200">{k}</div>
                      <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                        {typeof v === "number" ? v.toFixed(4) : v ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-700 dark:text-slate-300 mt-3">No benchmark metrics found for this model.</div>
              )}

              {/* Optional deep details (if endpoint returns them) */}
              {modelCheck && (Array.isArray(modelCheck.errors) || Array.isArray(modelCheck.warnings) || modelCheck.diff) ? (
                <details className="mt-4 rounded-2xl border border-blue-100/70 bg-white/70 p-3 dark:border-blue-900/50 dark:bg-slate-950/40">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-900 dark:text-slate-100">View check details</summary>

                  {Array.isArray(modelCheck.errors) && modelCheck.errors.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">Errors</div>
                      <ul className="mt-1 list-disc pl-5 text-xs text-slate-800 dark:text-slate-200">
                        {modelCheck.errors.map((e: string, i: number) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {Array.isArray(modelCheck.warnings) && modelCheck.warnings.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">Warnings</div>
                      <ul className="mt-1 list-disc pl-5 text-xs text-slate-800 dark:text-slate-200">
                        {modelCheck.warnings.map((w: string, i: number) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {modelCheck.diff ? (
                    <div className="mt-3 text-xs text-slate-800 dark:text-slate-200">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">Class diff</div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          ["Expected", modelCheck.diff.expected_nc],
                          ["Actual", modelCheck.diff.actual_nc],
                          ["Missing", (modelCheck.diff.missing_expected || []).length],
                          ["Extra", (modelCheck.diff.extra_actual || []).length],
                        ].map(([k, v]) => (
                          <div key={String(k)} className="rounded-xl border border-blue-100/70 bg-blue-50/40 px-3 py-2 dark:border-blue-900/50 dark:bg-blue-950/30">
                            <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-200">{k}</div>
                            <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{String(v ?? "—")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </details>
              ) : null}

              {!selectedModel.has_model && (
                <div className="text-xs text-rose-700 dark:text-rose-300 mt-3">Model file is missing on disk for this entry.</div>
              )}
              {!selectedModel.has_report && (
                <div className="text-xs text-amber-700 dark:text-amber-300 mt-2">Benchmark report is not available for this model.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
