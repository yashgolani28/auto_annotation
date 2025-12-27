import React, { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api } from "../api"
import { useToast } from "../components/Toast"

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Dataset = { id: number; name: string; project_id: number }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  card: "rounded-3xl border border-blue-100/70 bg-white/80 p-5 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  input:
    "w-full rounded-xl border border-blue-200/70 bg-white/90 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  textarea:
    "w-full rounded-2xl border border-blue-200/70 bg-white/90 p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "rounded-xl px-4 py-2 font-medium text-white transition-colors shadow-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "rounded-xl px-4 py-2 font-medium transition-colors border border-blue-200/70 bg-white/80 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  chip:
    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium bg-blue-50/80 text-blue-800 border-blue-200/70 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60",
}

export default function Project() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [classes, setClasses] = useState<LabelClass[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)

  const [classText, setClassText] = useState("Car\nTruck\nBus")
  const [datasetName, setDatasetName] = useState("Dataset 1")
  const [zipFile, setZipFile] = useState<File | null>(null)

  const [modelName, setModelName] = useState("Detector")
  const [modelFile, setModelFile] = useState<File | null>(null)

  const canSubmitClasses = useMemo(() => classText.trim().length > 0, [classText])
  const canUploadZip = useMemo(() => datasetName.trim().length > 0 && !!zipFile, [datasetName, zipFile])
  const canUploadModel = useMemo(() => modelName.trim().length > 0 && !!modelFile, [modelName, modelFile])

  async function refresh() {
    if (!projectId) return
    try {
      setLoading(true)
      const [c, d, m] = await Promise.all([
        api.get(`/api/projects/${projectId}/classes`),
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/models`),
      ])
      setClasses(c.data || [])
      setDatasets(d.data || [])
      setModels(m.data || [])
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Failed to load project data", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function saveClasses() {
    const lines = classText
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (!lines.length) {
      showToast("Please enter at least one class", "error")
      return
    }
    try {
      const payload = lines.map((name) => ({ name, color: "#3b82f6" }))
      await api.post(`/api/projects/${projectId}/classes`, payload)
      showToast(`Saved ${lines.length} classes`, "success")
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Failed to save classes", "error")
    }
  }

  async function createDataset() {
    const nm = datasetName.trim()
    if (!nm) throw new Error("Dataset name required")
    const r = await api.post(`/api/projects/${projectId}/datasets`, { name: nm })
    return r.data as Dataset
  }

  async function uploadZip() {
    if (!zipFile) return
    try {
      const ds = await createDataset()
      const form = new FormData()
      form.append("file", zipFile)
      await api.post(`/api/datasets/${ds.id}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } })
      showToast("Dataset uploaded", "success")
      setZipFile(null)
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Upload failed", "error")
    }
  }

  async function uploadModel() {
    if (!modelFile) return
    try {
      const form = new FormData()
      form.append("name", modelName.trim())
      form.append("file", modelFile)
      await api.post(`/api/projects/${projectId}/models`, form, { headers: { "Content-Type": "multipart/form-data" } })
      showToast("Model uploaded", "success")
      setModelFile(null)
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "Model upload failed", "error")
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className={UI.h1}>Project setup</div>
          <div className={UI.sub}>Create classes, upload datasets, and upload model weights.</div>
          <div className="mt-3">
            <Link className={UI.btnSecondary} to="/">
              Back to home
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className={UI.btnPrimary} to={`/project/${projectId}/annotate`}>
            Annotate
          </Link>
          <Link className={UI.btnSecondary} to={`/project/${projectId}/auto`}>
            Auto-annotate
          </Link>
          <Link className={UI.btnSecondary} to={`/project/${projectId}/view-auto`}>
            View auto-annotations
          </Link>
          <Link className={UI.btnSecondary} to={`/project/${projectId}/export`}>
            Export
          </Link>
          <Link className={UI.btnSecondary} to={`/project/${projectId}/jobs`}>
            Jobs
          </Link>
          <button className={UI.btnSecondary} onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        {/* Classes */}
        <div className={UI.card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">1) Classes</div>
              <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">One per line.</div>
            </div>
            <button className={UI.btnPrimary} onClick={saveClasses} disabled={!canSubmitClasses}>
              Save
            </button>
          </div>

          <textarea className={cx(UI.textarea, "mt-4 min-h-[140px]")} value={classText} onChange={(e) => setClassText(e.target.value)} />

          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map((c) => (
              <span key={c.id} className={UI.chip}>
                {c.name}
              </span>
            ))}
            {!classes.length && (
              <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4 w-full">
                No classes yet.
              </div>
            )}
          </div>
        </div>

        {/* Dataset upload */}
        <div className={UI.card}>
          <div className="font-semibold text-slate-900 dark:text-slate-100">2) Upload dataset</div>
          <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Upload a ZIP of images.</div>

          <div className="mt-4 flex flex-col md:flex-row gap-2">
            <input className={cx(UI.input, "flex-1")} value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder="Dataset name" />
            <input className={UI.input} type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] || null)} />
            <button className={UI.btnPrimary} onClick={uploadZip} disabled={!canUploadZip}>
              Upload
            </button>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Datasets</div>
            <div className="mt-2 grid gap-2">
              {datasets.map((d) => (
                <div key={d.id} className="rounded-2xl border border-blue-100/70 bg-white/70 p-4 dark:border-blue-900/50 dark:bg-slate-950/30">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{d.name}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">ID {d.id}</div>
                </div>
              ))}
              {!datasets.length && (
                <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
                  No datasets yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Model upload */}
        <div className={cx(UI.card, "xl:col-span-2")}>
          <div className="font-semibold text-slate-900 dark:text-slate-100">3) Upload pretrained weights</div>
          <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Upload a .pt or .onnx model.</div>

          <div className="mt-4 flex flex-col md:flex-row gap-2">
            <input className={cx(UI.input, "flex-1")} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Model name" />
            <input className={UI.input} type="file" accept=".pt,.onnx" onChange={(e) => setModelFile(e.target.files?.[0] || null)} />
            <button className={UI.btnPrimary} onClick={uploadModel} disabled={!canUploadModel}>
              Upload
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {models.map((m) => (
              <div key={m.id} className="rounded-2xl border border-blue-100/70 bg-white/70 p-4 dark:border-blue-900/50 dark:bg-slate-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{m.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      ID {m.id} • {m.framework}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!models.length && (
              <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
                No models uploaded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
