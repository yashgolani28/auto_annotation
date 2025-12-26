import React, { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { api, API_BASE } from "../api"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type Export = { id: number; fmt: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
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
      showToast(err?.response?.data?.detail || "failed to load export data", "error")
    }
  }

  useEffect(() => {
    if (projectId) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function doExport(fmt: "yolo" | "coco") {
    if (!datasetId || !setId) {
      showToast("please select a dataset and annotation set", "error")
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
      showToast(`export created (${fmt.toUpperCase()})`, "success")
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "export failed", "error")
    } finally {
      setExporting(false)
    }
  }

  function download() {
    if (!lastExport) return
    window.open(`${API_BASE}/api/exports/${lastExport.id}/download`, "_blank")
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-2xl font-semibold text-slate-900">export annotations</div>
        <div className="text-sm text-slate-500 mt-1">export your annotations in yolo or coco format</div>
      </div>

      <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-xs text-blue-600 mb-1 block font-medium">dataset</label>
            <select
              className="w-full border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
              value={datasetId}
              onChange={(e) => setDatasetId(Number(e.target.value))}
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-blue-600 mb-1 block font-medium">annotation set</label>
            <select
              className="w-full border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
              value={setId}
              onChange={(e) => setSetId(Number(e.target.value))}
            >
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.source})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm text-slate-800">include images in export</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={approvedOnly}
              onChange={(e) => setApprovedOnly(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm text-slate-800">export only approved annotations</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            className={cx(
              "rounded-xl px-6 py-2.5 font-medium transition-colors",
              "text-white",
              exporting || !datasetId || !setId
                ? "bg-blue-300 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 shadow-sm"
            )}
            onClick={() => doExport("yolo")}
            disabled={exporting || !datasetId || !setId}
          >
            {exporting ? "exporting..." : "export yolo"}
          </button>

          <button
            className={cx(
              "rounded-xl px-6 py-2.5 font-medium transition-colors",
              "text-white",
              exporting || !datasetId || !setId
                ? "bg-blue-300 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 shadow-sm"
            )}
            onClick={() => doExport("coco")}
            disabled={exporting || !datasetId || !setId}
          >
            {exporting ? "exporting..." : "export coco"}
          </button>

          {lastExport && (
            <button
              className="rounded-xl px-6 py-2.5 font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              onClick={download}
            >
              download export
            </button>
          )}
        </div>

        {lastExport && (
          <div className="mt-6 p-4 bg-blue-50/60 border border-blue-100/70 rounded-2xl">
            <div className="text-sm font-semibold text-slate-900">last export</div>
            <div className="text-xs text-slate-600 mt-1">
              id: {lastExport.id} • format: {lastExport.fmt.toUpperCase()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
