import React, { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useParams, Link } from "react-router-dom"
import { api, mediaUrlCandidates } from "../api"
import { useToast } from "../components/Toast"
import PageHeader from "../components/PageHeader"

type Dataset = { id: number; name: string }
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
type ItemWithAnnotations = Item & { annotationCount: number; annotations: Ann[] }

function _pathFromUrl(u: string) {
  try {
    const url = new URL(u)
    return url.pathname + url.search
  } catch {
    return u
  }
}

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  select:
    "border border-blue-200/70 rounded-xl px-3 py-2 bg-white/90 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40",
  btnPrimary:
    "bg-blue-600 text-white rounded-xl px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm font-medium dark:bg-sky-600 dark:hover:bg-sky-500",
  btnSecondary:
    "border border-blue-200/70 rounded-xl px-4 py-2 bg-white/80 hover:bg-blue-50 text-blue-700 transition-colors font-medium dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  chip:
    "inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm border border-blue-200/70 bg-blue-50/80 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
}

type SmartItemImageProps = {
  itemId: number
  alt: string
  className?: string
  loading?: "lazy" | "eager"
  imgRef?: React.RefObject<HTMLImageElement>
}

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
        const path = _pathFromUrl(u)
        const res = await api.get(path, { responseType: "blob" })
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
        const objectUrl = URL.createObjectURL(res.data)
        blobUrlRef.current = objectUrl
        setSrc(objectUrl)
        return
      } catch {}
    }
  }

  function handleError() {
    if (srcIdx + 1 < candidates.length) {
      const nextIdx = srcIdx + 1
      setSrcIdx(nextIdx)
      setSrc(candidates[nextIdx])
      return
    }
    void fetchAsAuthedBlob()
  }

  return <img ref={imgRef as any} src={src} onError={handleError} alt={alt} className={className} loading={loading} />
}

function AnnotationOverlay({
  item,
  annotations,
  classById,
}: {
  item: Item
  annotations: Ann[]
  classById: Record<number, LabelClass>
}) {
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete) setImgSize({ width: img.offsetWidth, height: img.offsetHeight })
    const handleLoad = () => img && setImgSize({ width: img.offsetWidth, height: img.offsetHeight })
    if (img) {
      img.addEventListener("load", handleLoad)
      return () => img.removeEventListener("load", handleLoad)
    }
  }, [item.id])

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
                  stroke={cls?.color || "#0ea5e9"}
                  strokeWidth={Math.max(2, Math.min(scaleX, scaleY) * 2)}
                />
                <text
                  x={ann.x * scaleX}
                  y={Math.max(12, ann.y * scaleY - 5)}
                  fill={cls?.color || "#0ea5e9"}
                  fontSize={Math.max(10, Math.min(scaleX, scaleY) * 12)}
                  fontWeight="bold"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
                >
                  {cls?.name || "Unknown"}
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

  const [approvingAll, setApprovingAll] = useState(false)
  const [approvingItemId, setApprovingItemId] = useState<number | null>(null)

  // Close modal on Escape
  useEffect(() => {
    if (!selectedItem) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedItem])

  // Prevent body scroll while modal is open
  useEffect(() => {
    if (!selectedItem) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [selectedItem])

  const classById = useMemo(() => {
    return classes.reduce((acc: Record<number, LabelClass>, c: LabelClass) => {
      acc[c.id] = c
      return acc
    }, {} as Record<number, LabelClass>)
  }, [classes])

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
    const res = await api.get(`/api/datasets/${did}/items-with-annotations`, {
      params: { annotation_set_id: asetId, aset: asetId, limit: 1, offset: 0 },
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
      const setCandidatesRaw = autoLikeSets.length ? autoLikeSets : allSets
      const dsCandidatesRaw = datasets

      const setCandidates = reorderById(setCandidatesRaw, prefAset)
      const dsCandidates = reorderById(dsCandidatesRaw, prefDid)

      for (const aset of setCandidates) {
        for (const ds of dsCandidates) {
          if (autoDetectRunId.current !== runId) return
          try {
            const ok = await probeHasAnyAnnotations(ds.id, aset.id)
            if (ok) {
              setDatasetId(ds.id)
              setAnnotationSetId(aset.id)
              return
            }
          } catch {}
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
        api.get(`/api/projects/${projectId}/classes`),
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

      const nextDatasetId = datasetId || (ds[0]?.id ?? 0)
      const nextSetId = annotationSetId || (sets[0]?.id ?? 0)

      if (!datasetId && nextDatasetId) setDatasetId(nextDatasetId)
      if (!annotationSetId && nextSetId) setAnnotationSetId(nextSetId)

      if ((!datasetId || !annotationSetId) && ds.length && sets.length) {
        const prefSet = (autoLike[0]?.id ?? nextSetId) || 0
        void autoDetectPair({ preferredDatasetId: nextDatasetId, preferredSetId: prefSet })
      }
    } catch (err: any) {
      console.error("refresh() failed:", err)
      showToast(err?.response?.data?.detail || "Failed to load data.", "error")
    } finally {
      setLoading(false)
    }
  }

  async function loadItemsWithAnnotations() {
    if (!datasetId || !annotationSetId) return
    try {
      setLoading(true)
      const res = await api.get(`/api/datasets/${datasetId}/items-with-annotations`, {
        params: { annotation_set_id: annotationSetId, aset: annotationSetId, limit: 500 },
      })

      const data = res.data as ItemsWithAnnotationsResponse
      const itemsWithAnns: ItemWithAnnotations[] = (data || []).map((entry) => ({
        ...entry.item,
        annotationCount: entry.annotation_count,
        annotations: entry.annotations,
      }))

      setItems(itemsWithAnns)
    } catch (err: any) {
      console.error("Failed to load items with annotations:", err)
      showToast(err?.response?.data?.detail || "Failed to load items.", "error")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function _isAutoAnn(a: Ann) {
    return a.confidence !== null && a.confidence !== undefined
  }

  async function approveAllAutoForProject() {
    if (!annotationSetId) return
    const ok = window.confirm(
      "Approve all auto-annotations for this annotation set across the entire project?\n\nThis will mark them as approved and is reversible only by editing annotations."
    )
    if (!ok) return

    try {
      setApprovingAll(true)
      const res = await api.post(
        `/api/projects/${projectId}/annotation-sets/${annotationSetId}/approve-auto`,
        {
          only_auto: true,
          dataset_id: datasetId || null,
        }
      )
      const updated = Number(res.data?.updated ?? 0)
      showToast(`Approved ${updated} auto-annotations`, "success")
      await loadItemsWithAnnotations()
    } catch (err: any) {
      console.error("approveAllAutoForProject failed:", err)
      showToast(err?.response?.data?.detail || "Failed to approve all auto-annotations.", "error")
    } finally {
      setApprovingAll(false)
    }
  }

  async function approveAutoForItem(item: ItemWithAnnotations) {
    if (!annotationSetId) return
    try {
      setApprovingItemId(item.id)
      const res = await api.post(`/api/projects/${projectId}/annotation-sets/${annotationSetId}/items/${item.id}/approve`, { only_auto: true })
      const updated = Number(res.data?.updated ?? 0)

      // update local state immediately for a snappy UI (auto anns only)
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== item.id) return it
          const nextAnns = it.annotations.map((a) => (_isAutoAnn(a) ? { ...a, approved: true } : a))
          return { ...it, annotations: nextAnns }
        })
      )
      setSelectedItem((prev) => {
        if (!prev || prev.id !== item.id) return prev
        const nextAnns = prev.annotations.map((a) => (_isAutoAnn(a) ? { ...a, approved: true } : a))
        return { ...prev, annotations: nextAnns }
      })

      showToast(`Approved ${updated} annotations for this image`, "success")
    } catch (err: any) {
      console.error("approveAutoForItem failed:", err)
      showToast(err?.response?.data?.detail || "Failed to approve annotations for this image.", "error")
    } finally {
      setApprovingItemId(null)
    }
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

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
      const className = classById[ann.class_id]?.name || "Unknown"
      stats[className] = (stats[className] || 0) + 1
    })
    return stats
  }, {} as Record<string, number>)

  const controls = (
    <>
      <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
        Back to project
      </Link>

      <select className={UI.select} value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            Dataset {d.id}: {d.name}
          </option>
        ))}
      </select>

      <select
        className={cx(UI.select, "disabled:opacity-60")}
        value={annotationSetId}
        onChange={(e) => setAnnotationSetId(Number(e.target.value))}
        disabled={visibleSets.length === 0}
        title={visibleSets.length === 0 ? "No annotation sets available" : ""}
      >
        {visibleSets.length === 0 ? (
          <option value={0}>No annotation set</option>
        ) : (
          visibleSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({String(s.source || "Unknown")})
            </option>
          ))
        )}
      </select>

      <button
        className={UI.btnSecondary}
        disabled={autoDetecting || datasets.length === 0 || allSets.length === 0}
        onClick={() => autoDetectPair({ preferredDatasetId: datasetId, preferredSetId: annotationSetId })}
        title="Scan datasets/sets to find where annotations exist"
      >
        {autoDetecting ? "Auto-detecting…" : "Auto-detect"}
      </button>

      <button
        className={UI.btnSecondary}
        disabled={!annotationSetId || approvingAll}
        onClick={approveAllAutoForProject}
        title="Approve all auto-annotations in this set across the entire dataset"
      >
        {approvingAll ? "Approving…" : "Approve all auto (Dataset)"}
      </button>

      {annotationSetId > 0 && (
        <Link to={`/project/${projectId}/annotate?dataset=${datasetId}&aset=${annotationSetId}`} className={UI.btnPrimary}>
          Open in editor
        </Link>
      )}
    </>
  )

  return (
    <div className="max-w-7xl">
      <PageHeader title="View auto-annotations" subtitle="Browse and review auto-annotated images." projectId={projectId} right={controls} />

      {loading && items.length === 0 ? (
        <div className="text-center py-12 text-blue-700 dark:text-blue-200">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-slate-900 dark:text-slate-100 mb-2 font-medium">No auto-annotated images found</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {annotationSetId === 0 ? "Select an annotation set to view images." : "This annotation set has no annotations for the selected dataset."}
          </div>

          {annotationSetId > 0 && (
            <div className="mt-4">
              <button className={UI.btnPrimary} disabled={autoDetecting} onClick={() => autoDetectPair({ preferredDatasetId: datasetId, preferredSetId: annotationSetId })}>
                {autoDetecting ? "Scanning…" : "Try auto-detecting the right dataset/set"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white/70 border border-blue-100/70 rounded-2xl p-4 mb-6 shadow-sm dark:bg-slate-950/40 dark:border-blue-900/50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Images</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{items.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Total annotations</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{totalAnnotations}</div>
              </div>
              <div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Avg per image</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{items.length > 0 ? (totalAnnotations / items.length).toFixed(1) : "0"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Classes detected</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{Object.keys(classStats).length}</div>
              </div>
            </div>

            {Object.keys(classStats).length > 0 && (
              <div className="mt-4 pt-4 border-t border-blue-100/70 dark:border-blue-900/50">
                <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">Class distribution</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(classStats)
                    .sort(([, a], [, b]) => b - a)
                    .map(([className, count]) => {
                      const cls = classes.find((c) => c.name === className)
                      return (
                        <div
                          key={className}
                          className={UI.chip}
                          style={{
                            backgroundColor: cls?.color ? `${cls.color}20` : undefined,
                            color: cls?.color ? cls.color : undefined,
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

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-white/70 border border-blue-100/70 rounded-2xl overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all cursor-pointer dark:bg-slate-950/40 dark:border-blue-900/50"
                onClick={() => setSelectedItem(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedItem(item)
                }}
              >
                <div className="relative aspect-square bg-blue-50 dark:bg-blue-950/40">
                  <SmartItemImage itemId={item.id} alt={item.file_name} className="w-full h-full object-contain" loading="lazy" />
                  <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">{item.annotationCount}</div>
                </div>
                <div className="p-3">
                  <div className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{item.file_name}</div>
                  <div className="text-xs text-blue-700 dark:text-blue-200 mt-1">
                    {item.width} × {item.height}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.annotations.slice(0, 3).map((ann, idx) => {
                      const cls = classById[ann.class_id]
                      return (
                        <span
                          key={idx}
                          className="text-xs px-2 py-0.5 rounded border border-blue-100/70 dark:border-blue-900/50"
                          style={{
                            backgroundColor: cls?.color ? `${cls.color}20` : "rgba(59,130,246,0.10)",
                            color: cls?.color || "inherit",
                          }}
                        >
                          {cls?.name || "Unknown"}
                          {ann.confidence !== null && ann.confidence !== undefined && <span className="ml-1 opacity-70">{(ann.confidence * 100).toFixed(0)}%</span>}
                        </span>
                      )
                    })}
                    {item.annotations.length > 3 && <span className="text-xs text-blue-700 dark:text-blue-200">+{item.annotations.length - 3}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedItem &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={() => setSelectedItem(null)} role="dialog" aria-modal="true">
            <div
              className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl border border-blue-100/70 dark:bg-slate-950 dark:border-blue-900/50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-blue-100/70 p-4 flex items-center justify-between dark:bg-slate-950 dark:border-blue-900/50">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{selectedItem.file_name}</div>
                  <div className="text-sm text-blue-700 dark:text-blue-200">
                    {selectedItem.width} × {selectedItem.height} • {selectedItem.annotationCount} annotations
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={UI.btnSecondary}
                    disabled={!annotationSetId || approvingItemId === selectedItem.id}
                    onClick={() => approveAutoForItem(selectedItem)}
                    title="Approve auto-annotations for this image"
                  >
                    {approvingItemId === selectedItem.id ? "Approving…" : "Approve this image"}
                  </button>

                  <Link to={`/project/${projectId}/annotate?dataset=${datasetId}&aset=${annotationSetId}&item=${selectedItem.id}`} className={UI.btnPrimary}>
                    Edit in editor
                  </Link>
                  <button onClick={() => setSelectedItem(null)} className={UI.btnSecondary}>
                    Close
                  </button>
                </div>
              </div>

              <div className="p-4">
                <div className="relative bg-blue-50 dark:bg-blue-950/40 rounded-xl overflow-hidden mb-4 border border-blue-100/70 dark:border-blue-900/50">
                  <AnnotationOverlay item={selectedItem} annotations={selectedItem.annotations} classById={classById} />
                </div>

                <div className="space-y-2">
                  <div className="font-semibold mb-2 text-slate-900 dark:text-slate-100">Annotations ({selectedItem.annotations.length})</div>
                  {selectedItem.annotations.map((ann, idx) => {
                    const cls = classById[ann.class_id]
                    return (
                      <div
                        key={idx}
                        className="border border-blue-100/70 rounded-xl p-3 bg-white/70 flex items-center justify-between hover:bg-blue-50/40 transition-colors dark:bg-slate-950/30 dark:border-blue-900/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded border border-blue-200/70 dark:border-blue-900/60" style={{ backgroundColor: cls?.color || "#3b82f6" }} />
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{cls?.name || "Unknown"}</div>
                            <div className="text-xs text-blue-700 dark:text-blue-200">
                              Box: ({ann.x.toFixed(0)}, {ann.y.toFixed(0)}) {ann.w.toFixed(0)}×{ann.h.toFixed(0)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-end flex-col gap-1">
                          <span
                            className={cx(
                              "text-xs px-2 py-0.5 rounded-full border",
                              ann.approved
                                ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                                : "border-amber-200/70 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                            )}
                          >
                            {ann.approved ? "Approved" : "Pending"}
                          </span>
                          {ann.confidence !== null && ann.confidence !== undefined && (
                            <div className="text-sm text-blue-800 dark:text-blue-200 font-medium">{(ann.confidence * 100).toFixed(1)}% confidence</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
