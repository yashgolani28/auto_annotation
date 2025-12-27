import React, { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, API_BASE } from "../api"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type Export = { id: number; fmt: string }

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
}

export default function ExportPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [sets, setSets] = useState<ASet[]>([])
  const [datasetId, setDatasetId] = useState<number>(0)
  const [setId, setSetId] = useState<number>(0)
  const [includeImages, setIncludeImages] = useState(true)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [lastExport, setLastExport] = useState<Export | null>(null)
  const [exporting, setExporting] = useState(false)

  const [jobId, setJobId] = useState<number>(0)
  const [artifacts, setArtifacts] = useState<any | null>(null)
  const [loadingArtifacts, setLoadingArtifacts] = useState(false)

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

  useEffect(() => {
    if (projectId) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    setArtifacts(null)
  }, [jobId])

  async function loadArtifacts(jid: number) {
    if (!jid) {
      showToast("Enter a valid job ID", "error")
      return
    }
    try {
      setLoadingArtifacts(true)
      const r = await api.get(`/api/jobs/${jid}/artifacts`)
      setArtifacts(r.data)
      showToast("Artifacts loaded", "success")
    } catch (err: any) {
      setArtifacts(null)
      showToast(err?.response?.data?.detail || "Failed to load artifacts", "error")
    } finally {
      setLoadingArtifacts(false)
    }
  }

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

  function download() {
    if (!lastExport) return
    window.open(`${API_BASE}/api/exports/${lastExport.id}/download`, "_blank")
  }

  return (
    <>
      <div className="max-w-6xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
          <div>
            <div className={UI.h1}>Export annotations</div>
            <div className={UI.sub}>Export your annotations in YOLO or COCO format.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
                Back to project
              </Link>
            </div>
          </div>
        </div>

        <div className={UI.card}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
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

          <div className="space-y-3 mb-6">
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

          <div className="flex flex-wrap gap-3">
            <button className={UI.btnPrimary} onClick={() => doExport("yolo")} disabled={exporting || !datasetId || !setId}>
              {exporting ? "Exporting…" : "Export YOLO"}
            </button>

            <button className={UI.btnPrimary} onClick={() => doExport("coco")} disabled={exporting || !datasetId || !setId}>
              {exporting ? "Exporting…" : "Export COCO"}
            </button>

            {lastExport && (
              <button className={UI.btnGood} onClick={download}>
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
      </div>

      <div className={cx("mt-8 max-w-6xl", UI.card)}>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Training artifacts</div>
        <div className={UI.sub}>Load artifacts generated by a training job.</div>

        <div className="flex items-center gap-3 mt-4">
          <input
            type="number"
            placeholder="Job ID"
            className={cx(UI.input, "w-36")}
            value={jobId || ""}
            onChange={(e) => setJobId(Number(e.target.value))}
          />
          <button
            className={UI.btnPrimary}
            disabled={!jobId || loadingArtifacts}
            onClick={() => loadArtifacts(jobId)}
          >
            {loadingArtifacts ? "Loading…" : "Load"}
          </button>
        </div>

        {artifacts && (
          <div className="flex flex-wrap gap-3 mt-4">
            {artifacts.model?.available && (
              <button
                className={UI.btnGood}
                onClick={() => window.open(`${API_BASE}/api/jobs/${jobId}/artifacts/model`, "_blank")}
              >
                Download model.pt
              </button>
            )}

            {artifacts.benchmark_report?.available && (
              <button
                className="rounded-xl px-6 py-2.5 font-medium text-white transition-colors bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                onClick={() => window.open(`${API_BASE}/api/jobs/${jobId}/artifacts/report`, "_blank")}
              >
                Download benchmark report
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
