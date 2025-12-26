import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api, mediaUrlCandidates } from "../api"
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

function _pathFromUrl(u: string) {
  try {
    const url = new URL(u)
    return url.pathname + url.search
  } catch {
    return u
  }
}

type SmartItemImageProps = {
  itemId: number
  alt: string
  className?: string
  loading?: "lazy" | "eager"
  imgRef?: React.RefObject<HTMLImageElement>
}

// Loads item images robustly in both setups:
// - media route mounted at /media/... or /api/media/...
// - media route requiring Authorization header (fallback to authed blob fetch)
function SmartItemImage({ itemId, alt, className, loading, imgRef }: SmartItemImageProps) {
  const candidates = useMemo(() => mediaUrlCandidates(itemId), [itemId])

  const [srcIdx, setSrcIdx] = useState(0)
  const [src, setSrc] = useState<string>(candidates[0] || "")
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setSrcIdx(0)
    setSrc(candidates[0] || "")

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, candidates.join("|")])

  async function fetchAsAuthedBlob() {
    for (const u of candidates) {
      try {
        const path = _pathFromUrl(u) // make it relative for axios baseURL
        const res = await api.get(path, { responseType: "blob" })

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
        const objectUrl = URL.createObjectURL(res.data)
        blobUrlRef.current = objectUrl
        setSrc(objectUrl)
        return
      } catch {
        // try next candidate
      }
    }
  }

  function handleError() {
    // 1) try next candidate URL
    if (srcIdx + 1 < candidates.length) {
      const nextIdx = srcIdx + 1
      setSrcIdx(nextIdx)
      setSrc(candidates[nextIdx])
      return
    }

    // 2) fallback: fetch with Authorization header via axios -> blob
    void fetchAsAuthedBlob()
  }

  return <img ref={imgRef as any} src={src} onError={handleError} alt={alt} className={className} loading={loading} />
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
  const imgRef = useRef<HTMLImageElement>(null)

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
      <SmartItemImage imgRef={imgRef} itemId={item.id} alt={item.file_name} className="w-full h-auto" />
      {imgSize && (
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }} viewBox={`0 0 ${imgSize.width} ${imgSize.height}`}>
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
                  {ann.confidence !== null && ann.confidence !== undefined && <> {(ann.confidence * 100).toFixed(0)}%</>}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

type ItemsWithAnnotationsResponse = Array<{ item: Item; annotations: Ann[]; annotation_count: number }>

export default function ViewAutoAnnotations() {
  const { id } = useParams()
  const projectId = Number(id)
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [allSets, setAllSets] = useState<ASet[]>([])
  const [autoLikeSets, setAutoLikeSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [loading, setLoading] = useState(false)

  const [datasetId, setDatasetId] = useState<number>(0)
  const [annotationSetId, setAnnotationSetId] = useState<number>(0)
  const [items, setItems] = useState<ItemWithAnnotations[]>([])
  const [selectedItem, setSelectedItem] = useState<ItemWithAnnotations | null>(null)

  const [autoDetecting, setAutoDetecting] = useState(false)
  const autoDetectRunId = useRef(0)

  const classById = useMemo(() => {
    return classes.reduce((acc: Record<number, LabelClass>, c: LabelClass) => {
      acc[c.id] = c
      return acc
    }, {} as Record<number, LabelClass>)
  }, [classes])

  // Show only sets relevant for current dataset if dataset_id exists.
  // If dataset_id is missing, keep it visible (most backends don't populate dataset_id on AnnotationSet).
  const visibleSets = useMemo(() => {
    if (!datasetId) return allSets
    return allSets.filter((s) => !s.dataset_id || s.dataset_id === datasetId)
  }, [allSets, datasetId])

  function reorderById<T extends { id: number }>(arr: T[], preferredId: number) {
    if (!preferredId) return arr
    const idx = arr.findIndex((x) => x.id === preferredId)
    if (idx <= 0) return arr
    return [arr[idx], ...arr.slice(0, idx), ...arr.slice(idx + 1)]
  }

  async function probeHasAnyAnnotations(did: number, asetId: number) {
    // Limit=1 probe (cheap): if it returns 1+ rows, that pair is valid.
    const res = await api.get(`/api/datasets/${did}/items-with-annotations`, {
      params: { annotation_set_id: asetId, aset: asetId, limit: 1, offset: 0 }
    })
    const data = res.data as ItemsWithAnnotationsResponse
    return Array.isArray(data) && data.length > 0
  }

  async function autoDetectPair(opts?: { preferredDatasetId?: number; preferredSetId?: number }) {
    const runId = ++autoDetectRunId.current
    const prefDid = opts?.preferredDatasetId || 0
    const prefAset = opts?.preferredSetId || 0

    if (datasets.length === 0 || allSets.length === 0) return

    setAutoDetecting(true)
    try {
      // Prefer "auto-ish" sets first, then everything else
      const setCandidatesRaw = autoLikeSets.length ? autoLikeSets : allSets
      const dsCandidatesRaw = datasets

      const setCandidates = reorderById(setCandidatesRaw, prefAset)
      const dsCandidates = reorderById(dsCandidatesRaw, prefDid)

      // Try: (preferred) -> scan until first match
      for (const aset of setCandidates) {
        for (const ds of dsCandidates) {
          if (autoDetectRunId.current !== runId) return // cancelled by a new run
          try {
            const ok = await probeHasAnyAnnotations(ds.id, aset.id)
            if (ok) {
              setDatasetId(ds.id)
              setAnnotationSetId(aset.id)
              return
            }
          } catch {
            // ignore probe errors, continue
          }
        }
      }

      showToast("Could not find any (dataset, set) pair with annotations.", "error")
    } finally {
      if (autoDetectRunId.current === runId) setAutoDetecting(false)
    }
  }

  async function refresh() {
    try {
      setLoading(true)
      const [d, s, c] = await Promise.all([
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
        api.get(`/api/projects/${projectId}/classes`)
      ])

      const ds = (d.data || []) as Dataset[]
      const sets = ((s.data || []) as ASet[]) || []
      const cls = (c.data || []) as LabelClass[]

      setDatasets(ds)
      setAllSets(sets)
      setClasses(cls)

      const autoLike = sets.filter((aset) => {
        const src = String(aset.source ?? "").toLowerCase().trim()
        const name = String(aset.name ?? "").toLowerCase().trim()
        return src.includes("auto") || name.includes("auto")
      })
      setAutoLikeSets(autoLike)

      // If user already has selections, keep them.
      // Otherwise pick defaults *robustly* by scanning for a pair that actually has annotations.
      const nextDatasetId = datasetId || (ds[0]?.id ?? 0)
      const nextSetId = annotationSetId || (sets[0]?.id ?? 0)

      if (!datasetId && nextDatasetId) setDatasetId(nextDatasetId)
      if (!annotationSetId && nextSetId) setAnnotationSetId(nextSetId)

      // Auto-detect only when we don't have BOTH chosen yet (initial load),
      // or when defaults are likely wrong.
      if ((!datasetId || !annotationSetId) && ds.length && sets.length) {
        // prefer autoLike set if available
        const prefSet = (autoLike[0]?.id ?? nextSetId) || 0
        void autoDetectPair({ preferredDatasetId: nextDatasetId, preferredSetId: prefSet })
      }
    } catch (err: any) {
      console.error("refresh() failed:", err)
      showToast(err?.response?.data?.detail || "Failed to load data", "error")
    } finally {
      setLoading(false)
    }
  }

  async function loadItemsWithAnnotations() {
    if (!datasetId || !annotationSetId) return
    try {
      setLoading(true)

      const res = await api.get(`/api/datasets/${datasetId}/items-with-annotations`, {
        // pass both names to be compatible with older/newer backends
        params: { annotation_set_id: annotationSetId, aset: annotationSetId, limit: 500 }
      })

      const data = res.data as ItemsWithAnnotationsResponse

      const itemsWithAnns: ItemWithAnnotations[] = (data || []).map((entry) => ({
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

  // If dataset changes, keep annotationSetId valid for that dataset filter (only if backend provides dataset_id on sets).
  useEffect(() => {
    if (!datasetId) return
    if (visibleSets.length === 0) {
      setAnnotationSetId(0)
      setItems([])
      return
    }
    const ok = visibleSets.some((s) => s.id === annotationSetId)
    if (!ok) setAnnotationSetId(visibleSets[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, visibleSets.length])

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
            disabled={visibleSets.length === 0}
            title={visibleSets.length === 0 ? "No annotation sets available" : ""}
          >
            {visibleSets.length === 0 ? (
              <option value={0}>no annotation set</option>
            ) : (
              visibleSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({String(s.source || "unknown")})
                </option>
              ))
            )}
          </select>

          <button
            className="border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-50 text-blue-700 transition-colors disabled:opacity-50"
            disabled={autoDetecting || datasets.length === 0 || allSets.length === 0}
            onClick={() => autoDetectPair({ preferredDatasetId: datasetId, preferredSetId: annotationSetId })}
            title="Scan datasets/sets to find where annotations exist"
          >
            {autoDetecting ? "Auto-detecting..." : "Auto-detect"}
          </button>

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
              ? "Select an annotation set to view images"
              : "This annotation set has no annotations for the selected dataset"}
          </div>

          {annotationSetId > 0 && (
            <div className="mt-4">
              <button
                className="bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm font-medium disabled:opacity-50"
                disabled={autoDetecting}
                onClick={() => autoDetectPair({ preferredDatasetId: datasetId, preferredSetId: annotationSetId })}
              >
                {autoDetecting ? "Scanning..." : "Try auto-detecting the right dataset/set"}
              </button>
            </div>
          )}
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
                <div className="text-2xl font-semibold">{items.length > 0 ? (totalAnnotations / items.length).toFixed(1) : "0"}</div>
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
                  <SmartItemImage itemId={item.id} alt={item.file_name} className="w-full h-full object-contain" loading="lazy" />
                  <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">{item.annotationCount}</div>
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
                            <span className="ml-1 opacity-70">{(ann.confidence * 100).toFixed(0)}%</span>
                          )}
                        </span>
                      )
                    })}
                    {item.annotations.length > 3 && <span className="text-xs text-blue-500">+{item.annotations.length - 3}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Image Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedItem(null)}>
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
                <button onClick={() => setSelectedItem(null)} className="border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-50 text-blue-700 transition-colors">
                  Close
                </button>
              </div>
            </div>

            <div className="p-4">
              <div className="relative bg-blue-50 rounded-lg overflow-hidden mb-4 border border-blue-200">
                <AnnotationOverlay item={selectedItem} annotations={selectedItem.annotations} classById={classById} />
              </div>

              <div className="space-y-2">
                <div className="font-semibold mb-2 text-slate-900">Annotations ({selectedItem.annotations.length})</div>
                {selectedItem.annotations.map((ann, idx) => {
                  const cls = classById[ann.class_id]
                  return (
                    <div
                      key={idx}
                      className="border border-blue-200 rounded-lg p-3 bg-white flex items-center justify-between hover:bg-blue-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded border border-blue-300" style={{ backgroundColor: cls?.color || "#3b82f6" }} />
                        <div>
                          <div className="font-medium text-slate-900">{cls?.name || "unknown"}</div>
                          <div className="text-xs text-blue-600">
                            Box: ({ann.x.toFixed(0)}, {ann.y.toFixed(0)}) {ann.w.toFixed(0)}×{ann.h.toFixed(0)}
                          </div>
                        </div>
                      </div>
                      {ann.confidence !== null && ann.confidence !== undefined && (
                        <div className="text-sm text-blue-700 font-medium">{(ann.confidence * 100).toFixed(1)}% confidence</div>
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
