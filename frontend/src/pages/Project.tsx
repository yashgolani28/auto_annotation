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

export default function Project() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [classes, setClasses] = useState<LabelClass[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)

  const [classText, setClassText] = useState("car\ntruck\nbus")
  const [datasetName, setDatasetName] = useState("dataset1")
  const [zipFile, setZipFile] = useState<File | null>(null)

  const [modelName, setModelName] = useState("detector")
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
      showToast(e?.response?.data?.detail || "failed to load project data", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function saveClasses() {
    const lines = classText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    if (!lines.length) {
      showToast("please enter at least one class", "error")
      return
    }
    try {
      const payload = lines.map((name) => ({ name, color: "#3b82f6" }))
      await api.post(`/api/projects/${projectId}/classes`, payload)
      showToast(`saved ${lines.length} classes`, "success")
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "failed to save classes", "error")
    }
  }

  async function createDataset() {
    const nm = datasetName.trim()
    if (!nm) throw new Error("dataset name required")
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
      showToast("dataset uploaded", "success")
      setZipFile(null)
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "upload failed", "error")
    }
  }

  async function uploadModel() {
    if (!modelFile) return
    try {
      const form = new FormData()
      form.append("name", modelName.trim())
      form.append("file", modelFile)
      await api.post(`/api/projects/${projectId}/models`, form, { headers: { "Content-Type": "multipart/form-data" } })
      showToast("model uploaded", "success")
      setModelFile(null)
      refresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "model upload failed", "error")
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">project setup</div>
          <div className="text-sm text-slate-500 mt-1">quick setup page for classes, datasets, models</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors" to={`/project/${projectId}/annotate`}>
            annotate
          </Link>
          <Link className="px-4 py-2 rounded-xl bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 transition-colors" to={`/project/${projectId}/auto`}>
            auto
          </Link>
          <Link className="px-4 py-2 rounded-xl bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 transition-colors" to={`/project/${projectId}/export`}>
            export
          </Link>
          <Link className="px-4 py-2 rounded-xl bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 transition-colors" to={`/project/${projectId}/jobs`}>
            jobs
          </Link>
          <button
            className={cx(
              "px-4 py-2 rounded-xl border transition-colors",
              loading ? "bg-blue-100 text-blue-500 border-blue-200 cursor-not-allowed" : "bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
            )}
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "loading..." : "refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        {/* classes */}
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">1) classes</div>
              <div className="text-xs text-slate-500 mt-1">one per line</div>
            </div>
            <button
              className={cx(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                canSubmitClasses ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-blue-100 text-blue-400 cursor-not-allowed"
              )}
              onClick={saveClasses}
              disabled={!canSubmitClasses}
            >
              save
            </button>
          </div>

          <textarea
            className="mt-4 w-full border border-blue-200 rounded-2xl p-3 min-h-[140px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            value={classText}
            onChange={(e) => setClassText(e.target.value)}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map((c) => (
              <span
                key={c.id}
                className="px-3 py-1 text-xs rounded-full border border-blue-200 bg-blue-50/80 text-blue-800"
              >
                {c.name}
              </span>
            ))}
            {!classes.length && (
              <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4 w-full">
                no classes yet.
              </div>
            )}
          </div>
        </div>

        {/* dataset upload */}
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 shadow-sm">
          <div className="font-semibold text-slate-900">2) upload dataset</div>
          <div className="text-xs text-slate-500 mt-1">zip of images</div>

          <div className="mt-4 flex flex-col md:flex-row gap-2">
            <input
              className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 flex-1"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="dataset name"
            />
            <input
              className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
            />
            <button
              className={cx(
                "rounded-xl px-4 py-2 font-medium transition-colors",
                canUploadZip ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-blue-100 text-blue-400 cursor-not-allowed"
              )}
              onClick={uploadZip}
              disabled={!canUploadZip}
            >
              upload
            </button>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-900">datasets</div>
            <div className="mt-2 grid gap-2">
              {datasets.map((d) => (
                <div key={d.id} className="border border-blue-200 rounded-2xl p-4 bg-white/80">
                  <div className="font-semibold text-slate-900">{d.name}</div>
                  <div className="text-xs text-slate-500 mt-1">id {d.id}</div>
                </div>
              ))}
              {!datasets.length && (
                <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  no datasets yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* model upload */}
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 shadow-sm xl:col-span-2">
          <div className="font-semibold text-slate-900">3) upload pretrained weights</div>
          <div className="text-xs text-slate-500 mt-1">.pt or .onnx</div>

          <div className="mt-4 flex flex-col md:flex-row gap-2">
            <input
              className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 flex-1"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="model name"
            />
            <input
              className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              type="file"
              accept=".pt,.onnx"
              onChange={(e) => setModelFile(e.target.files?.[0] || null)}
            />
            <button
              className={cx(
                "rounded-xl px-4 py-2 font-medium transition-colors",
                canUploadModel ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-blue-100 text-blue-400 cursor-not-allowed"
              )}
              onClick={uploadModel}
              disabled={!canUploadModel}
            >
              upload
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {models.map((m) => (
              <div key={m.id} className="border border-blue-200 rounded-2xl p-4 bg-white/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      id {m.id} • {m.framework}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!models.length && (
              <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                no models uploaded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
