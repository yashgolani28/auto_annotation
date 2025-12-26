import React, { useEffect, useMemo, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api, mediaUrl } from "../api"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }

// NOTE: add dataset_id (many backends include this)
type ASet = { id: number; name: string; source?: string | null; dataset_id?: number | null }

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Item = { id: number; file_name: string; width: number; height: number; split: string }
type Ann = {
  id: number
  class_id: number
  x: number
  y: number
  w: number
  h: number
  confidence?: number | null
  approved: boolean
}

type ItemWithAnnotations = Item & {
  annotationCount: number
  annotations: Ann[]
}

function AnnotationOverlay({
  item,
  annotations,
  classById
}: {
  item: Item
  annotations: Ann[]
  classById: Record<number, LabelClass>
}) {
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete) {
      setImgSize({ width: img.offsetWidth, height: img.offsetHeight })
    }
    const handleLoad = () => {
      if (img) setImgSize({ width: img.offsetWidth, height: img.offsetHeight })
    }
    if (img) {
      img.addEventListener("load", handleLoad)
      return () => img.removeEventListener("load", handleLoad)
    }
  }, [item.id])

  // guard against zero sizes coming from backend
  const denomW = item.width > 0 ? item.width : 1
  const denomH = item.height > 0 ? item.height : 1

  const scaleX = imgSize ? imgSize.width / denomW : 1
  const scaleY = imgSize ? imgSize.height / denomH : 1

  return (
    <div className="relative">
      <img ref={imgRef} src={mediaUrl(item.id)} alt={item.file_name} className="w-full h-auto" />
      {imgSize && (
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
          viewBox={`0 0 ${imgSize.width} ${imgSize.height}`}
        >
          {annotations.map((ann, idx) => {
            const cls = classById[ann.class_id]
            return (
              <g key={idx}>
                <rect
                  x={ann.x * scaleX}
                  y={ann.y * scaleY}
                  width={ann.w * scaleX}
                  height={ann.h * scaleY}
                  fill="none"
                  stroke={cls?.color || "#000"}
                  strokeWidth={Math.max(2, Math.min(scaleX, scaleY) * 2)}
                />
                <text
                  x={ann.x * scaleX}
                  y={Math.max(12, ann.y * scaleY - 5)}
                  fill={cls?.color || "#000"}
                  fontSize={Math.max(10, Math.min(scaleX, scaleY) * 12)}
                  fontWeight="bold"
                  style={{ textShadow: "0 1px 2px rgba(255,255,255,0.8)" }}
                >
                  {cls?.name || "unknown"}
                  {ann.confidence !== null && ann.confidence !== undefined && (
                    <> {(ann.confidence * 100).toFixed(0)}%</>
                  )}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

export default function ViewAutoAnnotations() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [allAutoSets, setAllAutoSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [loading, setLoading] = useState(false)

  const [datasetId, setDatasetId] = useState<number>(0)
  const [annotationSetId, setAnnotationSetId] = useState<number>(0)
  const [items, setItems] = useState<ItemWithAnnotations[]>([])
  const [selectedItem, setSelectedItem] = useState<ItemWithAnnotations | null>(null)

  const classById = useMemo(() => {
    return classes.reduce((acc: Record<number, LabelClass>, c: LabelClass) => {
      acc[c.id] = c
      return acc
    }, {} as Record<number, LabelClass>)
  }, [classes])

  // show only auto-sets relevant for current dataset (if dataset_id exists)
  const visibleAutoSets = useMemo(() => {
    if (!datasetId) return allAutoSets
    return allAutoSets.filter((s) => !s.dataset_id || s.dataset_id === datasetId)
  }, [allAutoSets, datasetId])

  async function refresh() {
    try {
      setLoading(true)
      const [d, s, c] = await Promise.all([
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
        api.get(`/api/projects/${projectId}/classes`)
      ])

      setDatasets(d.data)
      setClasses(c.data)

      // case-insensitive "auto"
      const autoAnnotationSets: ASet[] = (s.data as ASet[]).filter((aset) => {
        const src = String(aset.source ?? "").toLowerCase().trim()
        return src === "auto"
      })
      setAllAutoSets(autoAnnotationSets)

      // default dataset
      if (!datasetId && d.data.length) {
        setDatasetId(d.data[0].id)
      }

      // default annotation set (prefer one matching first dataset if dataset_id exists)
      if (!annotationSetId && autoAnnotationSets.length) {
        const preferredDatasetId = (d.data?.[0]?.id as number) || 0
        const preferred =
          autoAnnotationSets.find((x) => x.dataset_id && x.dataset_id === preferredDatasetId) ||
          autoAnnotationSets[0]
        setAnnotationSetId(preferred.id)
      }
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to load data", "error")
    } finally {
      setLoading(false)
    }
  }

  async function loadItemsWithAnnotations() {
    if (!datasetId || !annotationSetId) return
    try {
      setLoading(true)

      const res = await api.get(
        `/api/datasets/${datasetId}/items-with-annotations`,
        { params: { annotation_set_id: annotationSetId, limit: 500 } }
      )

      const data = res.data as Array<{ item: Item; annotations: Ann[]; annotation_count: number }>

      const itemsWithAnns: ItemWithAnnotations[] = data.map((entry) => ({
        ...entry.item,
        annotationCount: entry.annotation_count,
        annotations: entry.annotations
      }))

      setItems(itemsWithAnns)
    } catch (err: any) {
      console.error("Failed to load items with annotations:", err)
      showToast(err?.response?.data?.detail || "Failed to load items", "error")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // if dataset changes, ensure annotationSetId is valid for this dataset
  useEffect(() => {
    if (!datasetId) return
    if (visibleAutoSets.length === 0) {
      setAnnotationSetId(0)
      setItems([])
      return
    }
    const ok = visibleAutoSets.some((s) => s.id === annotationSetId)
    if (!ok) setAnnotationSetId(visibleAutoSets[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, visibleAutoSets.length])

  useEffect(() => {
    loadItemsWithAnnotations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, annotationSetId])

  const totalAnnotations = items.reduce((sum, item) => sum + item.annotationCount, 0)
  const classStats = items.reduce((stats: Record<string, number>, item) => {
    item.annotations.forEach((ann) => {
      const className = classById[ann.class_id]?.name || "unknown"
      stats[className] = (stats[className] || 0) + 1
    })
    return stats
  }, {} as Record<string, number>)

  return (
    <div className="max-w-7xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-2xl font-semibold">view auto annotations</div>
          <div className="text-sm text-zinc-500 mt-1">browse and review auto-annotated images</div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border border-blue-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            value={datasetId}
            onChange={(e) => setDatasetId(Number(e.target.value))}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                dataset {d.id}: {d.name}
              </option>
            ))}
          </select>

          <select
            className="border border-blue-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            value={annotationSetId}
            onChange={(e) => setAnnotationSetId(Number(e.target.value))}
            disabled={visibleAutoSets.length === 0}
            title={visibleAutoSets.length === 0 ? "No auto annotation sets for this dataset" : ""}
          >
            {visibleAutoSets.length === 0 ? (
              <option value={0}>no auto annotation set</option>
            ) : (
              visibleAutoSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (auto)
                </option>
              ))
            )}
          </select>

          {annotationSetId > 0 && (
            <Link
              to={`/project/${projectId}/annotate?dataset=${datasetId}&aset=${annotationSetId}`}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm font-medium"
            >
              Open in Editor
            </Link>
          )}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="text-center py-12 text-blue-600">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-blue-700 mb-2 font-medium">No auto-annotated images found</div>
          <div className="text-sm text-blue-600">
            {annotationSetId === 0
              ? "Select an auto-annotation set to view images"
              : "This annotation set has no annotations for the selected dataset"}
          </div>
        </div>
      ) : (
        <>
          {/* Statistics */}
          <div className="bg-white/80 border border-blue-200 rounded-xl p-4 mb-6 shadow-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-zinc-500">Images</div>
                <div className="text-2xl font-semibold">{items.length}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Total Annotations</div>
                <div className="text-2xl font-semibold">{totalAnnotations}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Avg per Image</div>
                <div className="text-2xl font-semibold">
                  {items.length > 0 ? (totalAnnotations / items.length).toFixed(1) : "0"}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Classes Detected</div>
                <div className="text-2xl font-semibold">{Object.keys(classStats).length}</div>
              </div>
            </div>

            {Object.keys(classStats).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-xs text-zinc-500 mb-2">Class Distribution</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(classStats)
                    .sort(([, a], [, b]) => b - a)
                    .map(([className, count]) => {
                      const cls = classes.find((c) => c.name === className)
                      return (
                        <div
                          key={className}
                          className="flex items-center gap-2 px-3 py-1 rounded-full text-sm"
                          style={{
                            backgroundColor: cls?.color ? `${cls.color}20` : "#f3f4f6",
                            color: cls?.color || "#374151"
                          }}
                        >
                          <span className="font-medium">{className}</span>
                          <span className="text-xs opacity-70">{count}</span>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Image Gallery */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-white/80 border border-blue-200 rounded-xl overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all cursor-pointer"
                onClick={() => setSelectedItem(item)}
              >
                <div className="relative aspect-square bg-blue-50">
                  <img
                    src={mediaUrl(item.id)}
                    alt={item.file_name}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                  <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                    {item.annotationCount}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-sm font-medium truncate text-slate-900">{item.file_name}</div>
                  <div className="text-xs text-blue-600 mt-1">
                    {item.width} × {item.height}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.annotations.slice(0, 3).map((ann, idx) => {
                      const cls = classById[ann.class_id]
                      return (
                        <span
                          key={idx}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: cls?.color ? `${cls.color}20` : "#f3f4f6",
                            color: cls?.color || "#374151"
                          }}
                        >
                          {cls?.name || "unknown"}
                          {ann.confidence !== null && ann.confidence !== undefined && (
                            <span className="ml-1 opacity-70">
                              {(ann.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </span>
                      )
                    })}
                    {item.annotations.length > 3 && (
                      <span className="text-xs text-blue-500">+{item.annotations.length - 3}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Image Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl border border-blue-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-blue-200 p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">{selectedItem.file_name}</div>
                <div className="text-sm text-blue-600">
                  {selectedItem.width} × {selectedItem.height} • {selectedItem.annotationCount} annotations
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/project/${projectId}/annotate?dataset=${datasetId}&aset=${annotationSetId}&item=${selectedItem.id}`}
                  className="bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm font-medium"
                >
                  Edit in Editor
                </Link>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-50 text-blue-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-4">
              <div className="relative bg-blue-50 rounded-lg overflow-hidden mb-4 border border-blue-200">
                <AnnotationOverlay item={selectedItem} annotations={selectedItem.annotations} classById={classById} />
              </div>

              <div className="space-y-2">
                <div className="font-semibold mb-2 text-slate-900">
                  Annotations ({selectedItem.annotations.length})
                </div>
                {selectedItem.annotations.map((ann, idx) => {
                  const cls = classById[ann.class_id]
                  return (
                    <div
                      key={idx}
                      className="border border-blue-200 rounded-lg p-3 bg-white flex items-center justify-between hover:bg-blue-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-4 h-4 rounded border border-blue-300"
                          style={{ backgroundColor: cls?.color || "#3b82f6" }}
                        />
                        <div>
                          <div className="font-medium text-slate-900">{cls?.name || "unknown"}</div>
                          <div className="text-xs text-blue-600">
                            Box: ({ann.x.toFixed(0)}, {ann.y.toFixed(0)}) {ann.w.toFixed(0)}×{ann.h.toFixed(0)}
                          </div>
                        </div>
                      </div>
                      {ann.confidence !== null && ann.confidence !== undefined && (
                        <div className="text-sm text-blue-700 font-medium">
                          {(ann.confidence * 100).toFixed(1)}% confidence
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
