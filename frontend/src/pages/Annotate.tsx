import React, { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { Stage, Layer, Rect, Text, Group, Image as KonvaImage, Line } from "react-konva"
import { api, mediaUrlCandidates } from "../api"
import { useAuth } from "../state/auth"
import { useToast } from "../components/Toast"

type Dataset = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type LabelClass = { id: number; name: string; color: string; order_index: number }
type Item = { id: number; file_name: string; width: number; height: number; split: string }
type Ann = {
  id?: number
  class_id: number
  x: number
  y: number
  w: number
  h: number
  confidence?: number | null
  approved: boolean
  attributes?: { note?: string; polygon?: number[] }
}
type LockState = { ok: boolean; expires_at?: string; error?: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

function _pathFromUrl(u: string) {
  try {
    const url = new URL(u)
    return url.pathname + url.search
  } catch {
    return u
  }
}

function _isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u)
}

function _detailToString(detail: any): string {
  if (!detail) return ""
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    // FastAPI 422: [{loc, msg, type}, ...]
    const msgs = detail.map((d) => d?.msg || d?.detail || "").filter(Boolean)
    if (msgs.length) return msgs.join("; ")
    try {
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  if (typeof detail === "object") {
    if (typeof (detail as any).error === "string") return (detail as any).error
    try {
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  return String(detail)
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

const UI = {
  h1: "text-2xl font-semibold text-slate-900 dark:text-slate-100",
  sub: "text-sm text-slate-600 dark:text-slate-300 mt-1",
  select:
    "border border-blue-200/70 rounded-xl px-3 py-2 bg-white/90 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
  btnPrimary:
    "bg-blue-600 text-white rounded-xl px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm disabled:bg-blue-300 disabled:cursor-not-allowed dark:bg-sky-600 dark:hover:bg-sky-500 dark:disabled:bg-slate-700",
  btnSecondary:
    "border border-blue-200/70 rounded-xl px-4 py-2 bg-white/80 hover:bg-blue-50 text-blue-700 transition-colors font-medium dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-blue-200 dark:hover:bg-blue-950/40",
  chip:
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium bg-blue-50/80 text-blue-800 border-blue-200/70 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60",
  card:
    "rounded-3xl border border-blue-100/70 bg-white/80 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  rightCard: "rounded-3xl border border-blue-100/70 bg-white/80 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/40",
  canvasShell:
    "rounded-3xl overflow-hidden border border-blue-200/25 bg-slate-950 shadow-lg shadow-blue-950/20 dark:border-blue-900/40",
  toolBtnBase: "px-2 py-1 rounded-lg border text-xs transition-colors",
  toolBtnActive: "bg-sky-700 text-white border-sky-500",
  toolBtnIdle: "bg-transparent border-slate-700 text-slate-200 hover:bg-slate-800",
  pillBase: "text-xs px-2.5 py-1 rounded-full border font-medium",
  pillOk:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50",
  pillBad: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/50",
  pillInfo:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60",
  textarea:
    "w-full border border-blue-200/70 rounded-xl px-2 py-2 text-xs bg-white/90 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 dark:border-blue-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-blue-700/40 dark:focus:border-blue-700/40",
}

function useAuthedKonvaImage(itemId: number | null) {
  const candidates = useMemo(() => (itemId ? mediaUrlCandidates(itemId) : []), [itemId])

  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blobUrlRef = useRef<string | null>(null)
  const runRef = useRef(0)

  useEffect(() => {
    const runId = ++runRef.current

    async function load() {
      setImage(null)
      setError(null)

      if (!itemId || candidates.length === 0) return

      setLoading(true)

      try {
        let lastErr: string | null = null

        for (const u of candidates) {
          if (runRef.current !== runId) return

          try {
            const res = _isAbsoluteUrl(u)
              ? await api.get(u, { responseType: "blob" })
              : await api.get(_pathFromUrl(u), { responseType: "blob" })

            if (runRef.current !== runId) return

            const ct = String(res.headers?.["content-type"] || "")
            if (ct && !ct.toLowerCase().startsWith("image/")) {
              lastErr = `Not an image response from ${u} (content-type: ${ct || "unknown"})`
              continue
            }

            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
            const objUrl = URL.createObjectURL(res.data)
            blobUrlRef.current = objUrl

            const img = new Image()
            img.src = objUrl

            try {
              // @ts-ignore
              if ("decode" in img) await img.decode()
              else {
                await new Promise<void>((resolve, reject) => {
                  img.onload = () => resolve()
                  img.onerror = () => reject(new Error("decode failed"))
                })
              }
            } catch {
              URL.revokeObjectURL(objUrl)
              if (blobUrlRef.current === objUrl) blobUrlRef.current = null
              lastErr = `Failed to decode image from ${u}`
              continue
            }

            if (runRef.current !== runId) return
            setImage(img)
            return
          } catch (e: any) {
            const status = e?.response?.status
            const detail = _detailToString(e?.response?.data?.detail || e?.response?.data)
            lastErr = `Fetch failed from ${u}${status ? ` (HTTP ${status})` : ""}${detail ? `: ${detail}` : ""}`
            continue
          }
        }

        setError(lastErr || "Failed to load image (media path/auth issue).")
      } finally {
        if (runRef.current === runId) setLoading(false)
      }
    }

    void load()

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, candidates.join("|")])

  return { image, loading, error }
}

export default function Annotate() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const projectId = Number(id)
  const { user } = useAuth()
  const { showToast } = useToast()

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [annotationSets, setAnnotationSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [annotationSetId, setAnnotationSetId] = useState<number>(0)
  const [activeClassId, setActiveClassId] = useState<number>(0)

  const [items, setItems] = useState<Item[]>([])
  const [index, setIndex] = useState(0)
  const item = items[index] || null

  const [anns, setAnns] = useState<Ann[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const [dirty, setDirty] = useState(false)

  type HistoryEntry = { anns: Ann[] }
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])

  const [lock, setLock] = useState<LockState>({ ok: false })
  const lockTimerRef = useRef<number | null>(null)

  const stageRef = useRef<any>(null)
  const [stageSize, setStageSize] = useState({ w: 1200, h: 720 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const [drawing, setDrawing] = useState(false)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Ann | null>(null)

  type Tool = "pan" | "draw" | "polygon" | "select"
  const [tool, setTool] = useState<Tool>("draw")

  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([])
  const [polyActive, setPolyActive] = useState(false)

  const canEdit = lock.ok || user?.role === "admin"

  const { image, loading: imageLoading, error: imageError } = useAuthedKonvaImage(item ? item.id : null)

  const thumbStart = Math.max(0, index - 8)
  const thumbEnd = Math.min(items.length, index + 9)
  const thumbs = items.slice(thumbStart, thumbEnd)

  const classById = useMemo(() => {
    const m: Record<number, LabelClass> = {}
    classes.forEach((c) => (m[c.id] = c))
    return m
  }, [classes])

  function normToStageX(px: number) {
    return (px - pos.x) / scale
  }
  function normToStageY(py: number) {
    return (py - pos.y) / scale
  }

  async function loadBase() {
    const [d, c, s] = await Promise.all([
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/classes`),
      api.get(`/api/projects/${projectId}/annotation-sets`),
    ])
    setDatasets(d.data || [])
    setClasses(c.data || [])
    setAnnotationSets(s.data || [])

    const urlDataset = searchParams.get("dataset")
    const urlAset = searchParams.get("aset")

    if (!datasetId) {
      if (urlDataset) {
        const dsId = Number(urlDataset)
        if ((d.data || []).find((ds: Dataset) => ds.id === dsId)) setDatasetId(dsId)
        else if ((d.data || []).length) setDatasetId(d.data[0].id)
      } else if ((d.data || []).length) setDatasetId(d.data[0].id)
    }

    if (!annotationSetId) {
      if (urlAset) {
        const asetId = Number(urlAset)
        if ((s.data || []).find((aset: ASet) => aset.id === asetId)) setAnnotationSetId(asetId)
        else if ((s.data || []).length) setAnnotationSetId(s.data[0].id)
      } else if ((s.data || []).length) setAnnotationSetId(s.data[0].id)
    }

    if (!activeClassId && (c.data || []).length) setActiveClassId(c.data[0].id)
  }

  async function loadItems(dsId: number) {
    const r = await api.get(`/api/datasets/${dsId}/items?limit=500&offset=0`)
    const list: Item[] = r.data || []
    setItems(list)

    const urlItem = searchParams.get("item")
    if (urlItem) {
      const wanted = Number(urlItem)
      const idx = list.findIndex((x) => x.id === wanted)
      if (idx >= 0) setIndex(idx)
    } else {
      setIndex(0)
    }
  }

  async function loadAnnotations(itemId: number, asetId: number) {
    const r = await api.get(`/api/items/${itemId}/annotations?annotation_set_id=${asetId}`)
    const list: Ann[] = r.data || []
    setAnns(list)
    setSelectedIdx(-1)
    setPast([])
    setFuture([])
    setDirty(false)
  }

  async function acquireLock(itemId: number, asetId: number) {
    try {
      const owner =
        (user as any)?.email ||
        (user as any)?.username ||
        String((user as any)?.id || "local")

      const r = await api.post(`/api/items/${itemId}/lock`, {
        annotation_set_id: asetId,
        owner,
        ttl_seconds: 300,
      })
      setLock({ ok: true, expires_at: r.data?.expires_at })
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
      lockTimerRef.current = window.setTimeout(() => {
        setLock({ ok: false, error: "Lock expired" })
      }, 1000 * 60 * 5)
    } catch (e: any) {
      const status = e?.response?.status
      const detail = _detailToString(e?.response?.data?.detail || e?.response?.data)
      setLock({ ok: false, error: `${status ? `HTTP ${status}: ` : ""}${detail || "Lock unavailable"}` })
    }
  }

  async function releaseLock(itemId: number, asetId: number) {
    try {
      const owner =
        (user as any)?.email ||
        (user as any)?.username ||
        String((user as any)?.id || "local")

      await api.post(`/api/items/${itemId}/unlock`, {
        annotation_set_id: asetId,
        owner,
      })
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!projectId) return
    void loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!datasetId) return
    void loadItems(datasetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  useEffect(() => {
    if (!item || !annotationSetId) return
    void loadAnnotations(item.id, annotationSetId)
    void acquireLock(item.id, annotationSetId)

    return () => {
      void releaseLock(item.id, annotationSetId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, annotationSetId])

  useEffect(() => {
    function onResize() {
      const w = Math.min(1200, window.innerWidth - 40)
      const h = Math.min(720, Math.max(420, Math.floor((w * 9) / 16)))
      setStageSize({ w, h })
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  function fitToScreen() {
    if (!item) return
    const pad = 20
    const w = stageSize.w - pad * 2
    const h = stageSize.h - pad * 2
    const sx = w / item.width
    const sy = h / item.height
    const s = clamp(Math.min(sx, sy), 0.05, 6)
    setScale(s)
    setPos({ x: pad, y: pad })
  }

  async function save() {
    if (!item || !annotationSetId) return
    try {
      await api.put(`/api/items/${item.id}/annotations?annotation_set_id=${annotationSetId}`, anns)
      setDirty(false)
      await acquireLock(item.id, annotationSetId)
      showToast("Annotations saved", "success")
    } catch (e: any) {
      showToast(_detailToString(e?.response?.data?.detail || e?.response?.data) || "Save failed", "error")
    }
  }

  function next() {
    if (dirty) {
      const ok = confirm("You have unsaved changes. Continue without saving?")
      if (!ok) return
    }
    setIndex((i) => Math.min(items.length - 1, i + 1))
  }

  function prev() {
    if (dirty) {
      const ok = confirm("You have unsaved changes. Continue without saving?")
      if (!ok) return
    }
    setIndex((i) => Math.max(0, i - 1))
  }

  function applyChange(mutator: (prev: Ann[]) => Ann[]) {
    setAnns((prevAnns) => {
      const nextAnns = mutator(prevAnns)
      setPast((p) => [...p, { anns: prevAnns }])
      setFuture([])
      setDirty(true)
      return nextAnns
    })
  }

  function undo() {
    setPast((p) => {
      if (!p.length) return p
      const last = p[p.length - 1]
      setFuture((f) => [...f, { anns }])
      setAnns(last.anns)
      setDirty(true)
      return p.slice(0, -1)
    })
  }

  function redo() {
    setFuture((f) => {
      if (!f.length) return f
      const last = f[f.length - 1]
      setPast((p) => [...p, { anns }])
      setAnns(last.anns)
      setDirty(true)
      return f.slice(0, -1)
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void save()
        return
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault()
        undo()
        return
      }
      if ((e.ctrlKey && e.key.toLowerCase() === "y") || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === "ArrowRight") next()
      if (e.key === "ArrowLeft") prev()
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdx >= 0) {
          applyChange((arr) => arr.filter((_, i) => i !== selectedIdx))
          setSelectedIdx(-1)
        }
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === "b") setTool("draw")
        if (e.key.toLowerCase() === "p") setTool("polygon")
        if (e.key.toLowerCase() === "v") setTool("select")
        if (e.key === " ") {
          e.preventDefault()
          setTool("pan")
        }
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1
        const c = classes[idx]
        if (c) setActiveClassId(c.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, dirty, item, annotationSetId, anns, classes, activeClassId, tool])

  function onWheel(e: any) {
    e.evt.preventDefault()
    if (!item) return
    const stage = stageRef.current
    const oldScale = scale
    const pointer = stage.getPointerPosition()
    const mousePointTo = { x: (pointer.x - pos.x) / oldScale, y: (pointer.y - pos.y) / oldScale }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const factor = 1.08
    const newScale = clamp(direction > 0 ? oldScale * factor : oldScale / factor, 0.05, 8)
    const newPos = { x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale }
    setScale(newScale)
    setPos(newPos)
  }

  function startDraw(e: any) {
    if (!item || !canEdit) return
    const stage = stageRef.current
    const p = stage.getPointerPosition()
    const x = normToStageX(p.x)
    const y = normToStageY(p.y)
    drawStart.current = { x, y }
    setDrawing(true)
    setDraft({ class_id: activeClassId, x, y, w: 1, h: 1, approved: false })
  }

  function updateDraw(e: any) {
    if (!drawing || !drawStart.current || !item) return
    const stage = stageRef.current
    const p = stage.getPointerPosition()
    const x2 = normToStageX(p.x)
    const y2 = normToStageY(p.y)
    const x1 = drawStart.current.x
    const y1 = drawStart.current.y
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const w = Math.abs(x2 - x1)
    const h = Math.abs(y2 - y1)
    setDraft((d) => (d ? { ...d, x, y, w, h } : d))
  }

  function endDraw() {
    if (!drawing || !draft || !item) {
      setDrawing(false)
      setDraft(null)
      drawStart.current = null
      return
    }
    setDrawing(false)
    drawStart.current = null

    if (draft.w < 4 || draft.h < 4) {
      setDraft(null)
      return
    }

    const x = clamp(draft.x, 0, item.width - 1)
    const y = clamp(draft.y, 0, item.height - 1)
    const w = clamp(draft.w, 1, item.width - x)
    const h = clamp(draft.h, 1, item.height - y)

    applyChange((arr) => [...arr, { ...draft, x, y, w, h }])
    setDraft(null)
  }

  function addPolygonPoint(e: any) {
    if (!item || !canEdit) return
    const stage = stageRef.current
    const p = stage.getPointerPosition()
    const x = normToStageX(p.x)
    const y = normToStageY(p.y)
    setPolyPoints((pts) => [...pts, { x, y }])
    setPolyActive(true)
  }

  function finishPolygon() {
    if (!item || !canEdit || polyPoints.length < 3) {
      setPolyPoints([])
      setPolyActive(false)
      return
    }
    const xs = polyPoints.map((p) => p.x)
    const ys = polyPoints.map((p) => p.y)
    const minX = clamp(Math.min(...xs), 0, item.width - 1)
    const minY = clamp(Math.min(...ys), 0, item.height - 1)
    const maxX = clamp(Math.max(...xs), 0, item.width - 1)
    const maxY = clamp(Math.max(...ys), 0, item.height - 1)
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const flattened: number[] = []
    polyPoints.forEach((p) => flattened.push(p.x, p.y))
    applyChange((arr) => [
      ...arr,
      { class_id: activeClassId, x: minX, y: minY, w, h, approved: false, attributes: { polygon: flattened } },
    ])
    setPolyPoints([])
    setPolyActive(false)
  }

  function toggleApproved(i: number) {
    applyChange((arr) => arr.map((a, idx) => (idx === i ? { ...a, approved: !a.approved } : a)))
  }

  function onBoxDrag(i: number, e: any) {
    if (!item) return
    const node = e.target
    const x = clamp(node.x(), 0, item.width - 1)
    const y = clamp(node.y(), 0, item.height - 1)
    applyChange((arr) => arr.map((a, idx) => (idx === i ? { ...a, x, y } : a)))
  }

  const banner = useMemo(() => {
    if (!item) return "No items"
    if (lock.ok) return `Lock ok${lock.expires_at ? ` • Expires ${new Date(lock.expires_at).toLocaleTimeString()}` : ""}`
    if (user?.role === "admin") return `Lock unavailable • Admin override${lock.error ? ` • ${lock.error}` : ""}`
    return `Locked: ${lock.error || "Unavailable"}`
  }, [item, lock, user?.role])

  return (
    <div className="max-w-[1400px]">
      {/* header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className={UI.h1}>Annotate</div>
          <div className={UI.sub}>Draw boxes • Ctrl+S save • Arrow keys navigate • Wheel zoom • Space pan</div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/project/${projectId}`} className={UI.btnSecondary}>
              Back to project
            </Link>
            <span className={UI.chip}>
              Tool: {tool === "draw" ? "Draw" : tool === "polygon" ? "Polygon" : tool === "pan" ? "Pan" : "Select"}
            </span>
            {user?.role ? (
              <span className={UI.chip}>Role: {String(user.role).replace(/^\w/, (c) => c.toUpperCase())}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select className={UI.select} value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                Dataset {d.id}: {d.name}
              </option>
            ))}
          </select>

          <select className={UI.select} value={annotationSetId} onChange={(e) => setAnnotationSetId(Number(e.target.value))}>
            {annotationSets.map((s) => (
              <option key={s.id} value={s.id}>
                Set {s.id}: {s.name} ({s.source})
              </option>
            ))}
          </select>

          <select className={UI.select} value={activeClassId} onChange={(e) => setActiveClassId(Number(e.target.value))}>
            {classes.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.name}
              </option>
            ))}
          </select>

          <button className={UI.btnSecondary} onClick={fitToScreen}>
            Fit
          </button>

          <button className={UI.btnPrimary} onClick={() => void save()} disabled={!canEdit}>
            Save
          </button>
        </div>
      </div>

      {/* status row */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className={cx(UI.pillBase, canEdit ? UI.pillOk : UI.pillBad)}>{banner}</div>

        <div className="text-sm text-slate-600 dark:text-slate-300">
          {item ? (
            <>
              <span className={cx(UI.pillBase, UI.pillInfo)}>
                {index + 1} / {items.length}
              </span>
              <span className="ml-2">{item.file_name}</span>
              <span className="ml-2 text-blue-700 dark:text-blue-200">
                {item.width}×{item.height}
              </span>
              <span className={cx("ml-2", dirty ? "text-orange-700 dark:text-orange-200 font-medium" : "text-emerald-700 dark:text-emerald-200")}>
                {dirty ? "Unsaved" : "Saved"}
              </span>
              {imageLoading ? <span className="ml-2 text-slate-400">Loading image…</span> : null}
              {imageError ? <span className="ml-2 text-rose-400">{imageError}</span> : null}
            </>
          ) : (
            "—"
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 mt-4">
        {/* canvas */}
        <div className={UI.canvasShell}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200/20">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium mr-3 text-slate-50">Canvas</div>

              <div className="flex items-center gap-1 text-xs">
                {[
                  ["draw", "Draw", "B"],
                  ["polygon", "Polygon", "P"],
                  ["pan", "Pan", "Space"],
                  ["select", "Select", "V"],
                ].map(([key, label, hint]) => (
                  <button
                    key={key}
                    className={cx(UI.toolBtnBase, tool === (key as Tool) ? UI.toolBtnActive : UI.toolBtnIdle)}
                    onClick={() => setTool(key as Tool)}
                    title={`${label} (${hint})`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-300">
              <button
                className="px-2 py-1 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50"
                onClick={undo}
                disabled={!past.length}
              >
                Undo
              </button>
              <button
                className="px-2 py-1 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50"
                onClick={redo}
                disabled={!future.length}
              >
                Redo
              </button>
              <span className="opacity-80">Scale {scale.toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-slate-900">
            <Stage
              ref={stageRef}
              width={stageSize.w}
              height={stageSize.h}
              scaleX={scale}
              scaleY={scale}
              x={pos.x}
              y={pos.y}
              draggable={tool === "pan"}
              onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
              onWheel={onWheel}
              onMouseDown={(e) => {
                const clsName = e?.target?.getClassName?.() || ""
                const isAnnoShape = clsName === "Rect" || clsName === "Text" || clsName === "Line" || clsName === "Group"

                if (tool === "draw") {
                  if (isAnnoShape) return
                  startDraw(e)
                  return
                }

                if (tool === "polygon") {
                  if (isAnnoShape) return
                  addPolygonPoint(e)
                  return
                }

                if (tool === "select") {
                  // clicking image/background clears selection
                  if (clsName === "Stage" || clsName === "Image") setSelectedIdx(-1)
                }
              }}
              onMouseMove={(e) => {
                if (tool === "draw") updateDraw(e)
              }}
              onMouseUp={() => {
                if (tool === "draw") endDraw()
              }}
              onDblClick={finishPolygon}
            >
              <Layer>
                {image && item && (
                  <KonvaImage image={image} x={0} y={0} width={item.width} height={item.height} crossOrigin="anonymous" />
                )}
              </Layer>

              <Layer>
                {anns.map((a, i) => {
                  const cls = classById[a.class_id]
                  const stroke = cls?.color || "#22c55e"
                  const selected = i === selectedIdx
                  const polygon = a.attributes?.polygon
                  const hasPolygon = Array.isArray(polygon) && polygon.length >= 6
                  return (
                    <Group key={i}>
                      <Rect
                        x={a.x}
                        y={a.y}
                        width={a.w}
                        height={a.h}
                        stroke={stroke}
                        strokeWidth={selected ? 3 : 2}
                        dash={a.approved ? [] : [6, 4]}
                        draggable={canEdit && tool === "select"}
                        onClick={() => setSelectedIdx(i)}
                        onTap={() => setSelectedIdx(i)}
                        onDragEnd={(e) => onBoxDrag(i, e)}
                        opacity={a.approved ? 0.35 : 0.25}
                        fill={stroke}
                      />
                      {hasPolygon && <Line points={polygon as number[]} stroke={stroke} strokeWidth={2} closed opacity={0.6} />}
                      <Text
                        x={a.x}
                        y={Math.max(0, a.y - 18)}
                        text={`${cls?.name || a.class_id}${a.confidence != null ? ` ${(a.confidence * 100).toFixed(0)}%` : ""}${a.approved ? " ✓" : ""}`}
                        fontSize={14}
                        fill={stroke}
                      />
                    </Group>
                  )
                })}

                {draft && tool === "draw" && (
                  <Rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} stroke={"#0ea5e9"} strokeWidth={2} dash={[6, 4]} />
                )}
                {polyActive && polyPoints.length > 1 && <Line points={polyPoints.flatMap((p) => [p.x, p.y])} stroke="#0ea5e9" strokeWidth={2} />}
              </Layer>
            </Stage>
          </div>

          {/* thumbnails */}
          <div className="border-t border-blue-200/30 p-2 bg-white/90 dark:bg-slate-950/40">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button className={UI.btnSecondary} onClick={prev}>
                Prev
              </button>

              {thumbs.map((t, i) => {
                const realIdx = thumbStart + i
                const active = realIdx === index
                return (
                  <button
                    key={t.id}
                    onClick={() => setIndex(realIdx)}
                    className={cx(
                      "px-3 py-2 rounded-xl text-sm border whitespace-nowrap transition-colors font-medium",
                      active
                        ? "bg-blue-600 text-white border-blue-600 dark:bg-sky-600 dark:border-sky-700/50"
                        : "bg-white/90 border-blue-200/70 hover:bg-blue-50 text-blue-700 dark:bg-slate-950/40 dark:border-blue-900/60 dark:text-blue-200 dark:hover:bg-blue-950/40"
                    )}
                    title={t.file_name}
                  >
                    {realIdx + 1}
                  </button>
                )
              })}

              <button className={UI.btnSecondary} onClick={next}>
                Next
              </button>
            </div>
          </div>
        </div>
        
        {/* right panel */}
        <div className={cx(UI.rightCard, "p-4 flex flex-col gap-4")}>
          {/* classes */}
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">Classes</div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">Click to select • 1..9 hotkeys</div>

            <div className="mt-3 flex flex-wrap gap-2">
              {classes.map((c, idx) => {
                const isActive = c.id === activeClassId
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveClassId(c.id)}
                    className={cx(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors font-medium",
                      isActive
                        ? "border-blue-600 bg-blue-600 text-white dark:bg-sky-600 dark:border-sky-700/50"
                        : "bg-white/90 border-blue-200/70 text-blue-700 hover:bg-blue-50 dark:bg-slate-950/40 dark:border-blue-900/60 dark:text-blue-200 dark:hover:bg-blue-950/40"
                    )}
                    title={`Press ${idx + 1} to select`}
                  >
                    <span className="w-3 h-3 rounded-full border border-blue-200/70 dark:border-blue-900/60" style={{ backgroundColor: c.color }} />
                    <span>
                      {idx + 1}. {c.name}
                    </span>
                  </button>
                )
              })}
              {!classes.length && <div className="text-xs text-slate-600 dark:text-slate-300">No classes defined.</div>}
            </div>
          </div>

          {/* boxes */}
          <div className="flex-1 min-h-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">Boxes</div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  Click a row to select. Toggle Approved for export filtering.
                </div>
              </div>
              <span className={cx(UI.chip, "shrink-0")}>{anns.length} total</span>
            </div>

            <div className="mt-3 space-y-2 max-h-[520px] overflow-auto pr-1">
              {anns.map((a, i) => {
                const cls = classById[a.class_id]
                const selected = i === selectedIdx
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedIdx(i)}
                    className={cx(
                      "w-full text-left rounded-2xl border p-3 transition-colors",
                      selected
                        ? "border-sky-400 bg-sky-50/80 dark:border-sky-700/60 dark:bg-sky-950/30"
                        : "border-blue-100/70 bg-white/70 hover:bg-blue-50/40 dark:border-blue-900/50 dark:bg-slate-950/30 dark:hover:bg-blue-950/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cls?.color || "#22c55e" }} />
                        <div className="font-medium text-slate-900 dark:text-slate-100">{cls?.name || `Class ${a.class_id}`}</div>
                      </div>

                      <button
                        className={cx(
                          UI.pillBase,
                          a.approved ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50"
                                     : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-200 dark:border-slate-700/60"
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleApproved(i)
                        }}
                      >
                        {a.approved ? "Approved" : "Not approved"}
                      </button>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1 flex flex-wrap gap-2">
                      <span>X {a.x.toFixed(0)}</span>
                      <span>Y {a.y.toFixed(0)}</span>
                      <span>W {a.w.toFixed(0)}</span>
                      <span>H {a.h.toFixed(0)}</span>
                      {a.confidence != null && <span>Conf {(a.confidence * 100).toFixed(0)}%</span>}
                    </div>

                    {selected && (
                      <div className="mt-2">
                        <textarea
                          className={UI.textarea}
                          placeholder="Comment / QA note…"
                          value={a.attributes?.note || ""}
                          onChange={(e) => {
                            const value = e.target.value
                            applyChange((arr) =>
                              arr.map((ann, idx) => (idx === i ? { ...ann, attributes: { ...(ann.attributes || {}), note: value } } : ann))
                            )
                          }}
                        />
                      </div>
                    )}
                  </button>
                )
              })}

              {!anns.length && (
                <div className="text-sm text-blue-700 dark:text-blue-200 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100/70 dark:border-blue-900/50 rounded-2xl p-4">
                  No boxes yet. Drag on the canvas to create one.
                </div>
              )}
            </div>
          </div>

          {/* help */}
          <div className="mt-2 border-t border-blue-100/70 dark:border-blue-900/50 pt-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100">Hotkeys</div>
            <ul className="list-disc ml-4 mt-2 space-y-1">
              <li>Ctrl+S: Save</li>
              <li>Left/Right: Switch image</li>
              <li>B: Draw • V: Select • Space: Pan • P: Polygon</li>
              <li>1..9: Select class</li>
              <li>Delete: Delete selected box</li>
              <li>W A S D: Nudge selected box (Shift = larger step)</li>
              <li>Mouse wheel: Zoom</li>
              <li>Double click: Finish polygon</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
