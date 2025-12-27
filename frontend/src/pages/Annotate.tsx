import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { Stage, Layer, Rect, Text, Group, Image as KonvaImage, Line } from "react-konva"
import useImage from "use-image"
import { api, mediaUrl } from "../api"
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

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export default function Annotate() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const projectId = Number(id)
  const { user } = useAuth()
  const { showToast } = useToast()

  // selectors
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [annotationSets, setAnnotationSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [annotationSetId, setAnnotationSetId] = useState<number>(0)
  const [activeClassId, setActiveClassId] = useState<number>(0)

  // items + paging
  const [items, setItems] = useState<Item[]>([])
  const [index, setIndex] = useState(0)
  const item = items[index] || null

  // annotations
  const [anns, setAnns] = useState<Ann[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const [dirty, setDirty] = useState(false)

  // undo / redo history
  type HistoryEntry = { anns: Ann[] }
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])

  // lock
  const [lock, setLock] = useState<LockState>({ ok: false })
  const lockTimerRef = useRef<number | null>(null)

  // stage/viewport
  const stageRef = useRef<any>(null)
  const [stageSize, setStageSize] = useState({ w: 1200, h: 720 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // draw state
  const [drawing, setDrawing] = useState(false)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Ann | null>(null)

  type Tool = "pan" | "draw" | "polygon" | "select"
  const [tool, setTool] = useState<Tool>("draw")

  // polygon
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([])
  const [polyActive, setPolyActive] = useState(false)

  // image
  const imgUrl = item ? mediaUrl(item.id) : ""
  const [image] = useImage(imgUrl, "anonymous")

  // thumbnails strip
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
    const urlItem = searchParams.get("item")

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

    // if urlItem exists, loadItems handles jumping
    if (urlItem) void urlItem
  }

  async function loadItems(dsId: number) {
    const r = await api.get(`/api/datasets/${dsId}/items?limit=500&offset=0`)
    const list: Item[] = r.data || []
    setItems(list)

    const urlItem = searchParams.get("item")
    if (urlItem) {
      const itemId = Number(urlItem)
      const itemIndex = list.findIndex((it) => it.id === itemId)
      if (itemIndex >= 0) {
        setIndex(itemIndex)
        return
      }
    }
    setIndex(0)
  }

  async function loadAnnotations(itemId: number, asetId: number) {
    const r = await api.get(`/api/items/${itemId}/annotations?annotation_set_id=${asetId}`)
    setAnns(r.data || [])
    setSelectedIdx(-1)
    setDirty(false)
    setPast([])
    setFuture([])
  }

  async function acquireLock(itemId: number, asetId: number) {
    try {
      const r = await api.post(`/api/items/${itemId}/lock?annotation_set_id=${asetId}`)
      setLock({ ok: true, expires_at: r.data.expires_at })
    } catch (e: any) {
      setLock({ ok: false, error: e?.response?.data?.detail || "lock failed" })
    }
  }

  function startLockLeaseRefresh(itemId: number, asetId: number) {
    stopLockLeaseRefresh()
    lockTimerRef.current = window.setInterval(() => {
      acquireLock(itemId, asetId)
    }, 60_000) as any
  }

  function stopLockLeaseRefresh() {
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current)
      lockTimerRef.current = null
    }
  }

  useEffect(() => {
    if (!projectId) return
    loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!datasetId) return
    loadItems(datasetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  useEffect(() => {
    if (!item || !annotationSetId) return

    fitToScreen()
    loadAnnotations(item.id, annotationSetId)
    acquireLock(item.id, annotationSetId)
    startLockLeaseRefresh(item.id, annotationSetId)

    return () => stopLockLeaseRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, annotationSetId])

  useEffect(() => {
    function onResize() {
      const w = window.innerWidth - 64 - 256
      const h = window.innerHeight - 130
      setStageSize({ w: Math.max(900, w), h: Math.max(520, h) })
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  function fitToScreen() {
    if (!item) return
    const pad = 40
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
      showToast("annotations saved", "success")
    } catch (e: any) {
      showToast(e?.response?.data?.detail || "save failed", "error")
    }
  }

  function next() {
    if (dirty) {
      const ok = confirm("you have unsaved changes. continue without saving?")
      if (!ok) return
    }
    setIndex((i) => Math.min(items.length - 1, i + 1))
  }

  function prev() {
    if (dirty) {
      const ok = confirm("you have unsaved changes. continue without saving?")
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
        save()
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
      if (selectedIdx >= 0) {
        const step = e.shiftKey ? 10 : 1
        let dx = 0,
          dy = 0
        if (e.key === "w") dy = -step
        if (e.key === "s") dy = step
        if (e.key === "a") dx = -step
        if (e.key === "d") dx = step
        if (dx || dy) {
          e.preventDefault()
          applyChange((arr) =>
            arr.map((b, i) => {
              if (i !== selectedIdx) return b
              return {
                ...b,
                x: clamp(b.x + dx, 0, (item?.width || 1) - 1),
                y: clamp(b.y + dy, 0, (item?.height || 1) - 1),
              }
            })
          )
        }
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
    if (!item || !lock.ok) return
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
    if (!item || !lock.ok) return
    const stage = stageRef.current
    const p = stage.getPointerPosition()
    const x = normToStageX(p.x)
    const y = normToStageY(p.y)
    setPolyPoints((pts) => [...pts, { x, y }])
    setPolyActive(true)
  }

  function finishPolygon() {
    if (!item || !lock.ok || polyPoints.length < 3) {
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
    if (!item) return "no items"
    if (!lock.ok) return `locked: ${lock.error || "unavailable"}`
    return `lock ok${lock.expires_at ? ` • expires ${new Date(lock.expires_at).toLocaleTimeString()}` : ""}`
  }, [item, lock])

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-slate-900">annotate</div>
          <div className="text-sm text-slate-500 mt-1">
            draw boxes • ctrl+s save • arrows navigate • wheel zoom • space pan
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
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
            className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            value={annotationSetId}
            onChange={(e) => setAnnotationSetId(Number(e.target.value))}
          >
            {annotationSets.map((s) => (
              <option key={s.id} value={s.id}>
                aset {s.id}: {s.name} ({s.source})
              </option>
            ))}
          </select>

          <select
            className="border border-blue-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            value={activeClassId}
            onChange={(e) => setActiveClassId(Number(e.target.value))}
          >
            {classes.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.name}
              </option>
            ))}
          </select>

          <button className="border border-blue-200 rounded-xl px-3 py-2 bg-white hover:bg-blue-50 text-blue-700 transition-colors" onClick={fitToScreen}>
            fit
          </button>

          <button
            className="bg-blue-600 text-white rounded-xl px-4 py-2 hover:bg-blue-700 transition-colors shadow-sm disabled:bg-blue-300 disabled:cursor-not-allowed"
            onClick={save}
            disabled={!lock.ok}
          >
            save
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className={cx("text-sm", lock.ok ? "text-emerald-700" : "text-red-700")}>{banner}</div>
        <div className="text-sm text-slate-500">
          {item ? (
            <>
              {index + 1} / {items.length} • {item.file_name} • {item.width}×{item.height} •{" "}
              <span className={dirty ? "text-orange-700 font-medium" : ""}>{dirty ? "unsaved" : "saved"}</span>
            </>
          ) : (
            "—"
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 mt-4">
        {/* canvas */}
        <div className="bg-slate-950 border border-blue-200/25 rounded-3xl overflow-hidden shadow-lg shadow-blue-950/20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200/20">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium mr-3 text-slate-50">canvas</div>

              <div className="flex items-center gap-1 text-xs">
                {[
                  ["draw", "draw", "b"],
                  ["polygon", "polygon", "p"],
                  ["pan", "pan", "space"],
                  ["select", "select", "v"],
                ].map(([key, label, hint]) => (
                  <button
                    key={key}
                    className={cx(
                      "px-2 py-1 rounded-lg border text-xs transition-colors",
                      tool === (key as Tool)
                        ? "bg-sky-700 text-white border-sky-500"
                        : "bg-transparent border-slate-700 text-slate-200 hover:bg-slate-800"
                    )}
                    onClick={() => setTool(key as Tool)}
                    title={`${label} (${hint})`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-300">
              <button className="px-2 py-1 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50" onClick={undo} disabled={!past.length}>
                undo
              </button>
              <button className="px-2 py-1 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50" onClick={redo} disabled={!future.length}>
                redo
              </button>
              <span className="opacity-80">scale {scale.toFixed(2)}</span>
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
                const clickedOnEmpty = e.target === e.target.getStage()
                if (!clickedOnEmpty) return
                if (tool === "draw") startDraw(e)
                else if (tool === "polygon") addPolygonPoint(e)
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
                {image && item && <KonvaImage image={image} x={0} y={0} width={item.width} height={item.height} />}
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
                        draggable={lock.ok && tool !== "pan"}
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

                {draft && tool === "draw" && <Rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} stroke={"#0ea5e9"} strokeWidth={2} dash={[6, 4]} />}
                {polyActive && polyPoints.length > 1 && <Line points={polyPoints.flatMap((p) => [p.x, p.y])} stroke="#0ea5e9" strokeWidth={2} />}
              </Layer>
            </Stage>
          </div>

          {/* thumbnails */}
          <div className="border-t border-blue-100/40 p-2 bg-white/85">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button className="border border-blue-200 rounded-xl px-3 py-1.5 text-sm bg-white hover:bg-blue-50 text-blue-700 transition-colors" onClick={prev}>
                prev
              </button>

              {thumbs.map((t, i) => {
                const realIdx = thumbStart + i
                const active = realIdx === index
                return (
                  <button
                    key={t.id}
                    onClick={() => setIndex(realIdx)}
                    className={cx(
                      "px-3 py-2 rounded-xl text-sm border whitespace-nowrap transition-colors",
                      active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-blue-200 hover:bg-blue-50 text-blue-700"
                    )}
                    title={t.file_name}
                  >
                    {realIdx + 1}
                  </button>
                )
              })}

              <button className="border border-blue-200 rounded-xl px-3 py-1.5 text-sm bg-white hover:bg-blue-50 text-blue-700 transition-colors" onClick={next}>
                next
              </button>
            </div>
          </div>
        </div>

        {/* right panel */}
        <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-4 shadow-sm flex flex-col gap-4">
          <div>
            <div className="font-semibold text-slate-900">classes</div>
            <div className="text-xs text-slate-500 mt-1">click to pick active class • 1..9 hotkeys</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {classes.map((c, idx) => {
                const isActive = c.id === activeClassId
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveClassId(c.id)}
                    className={cx(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors",
                      isActive ? "border-blue-600 bg-blue-600 text-white" : "bg-white border-blue-200 text-blue-700 hover:bg-blue-50"
                    )}
                    title={`press ${idx + 1} to select`}
                  >
                    <span className="w-3 h-3 rounded-full border" style={{ backgroundColor: c.color }} />
                    <span>
                      {idx + 1}. {c.name}
                    </span>
                  </button>
                )
              })}
              {!classes.length && <div className="text-xs text-slate-500">no classes defined. add them in the project dashboard.</div>}
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <div className="font-semibold text-slate-900">boxes</div>
            <div className="text-xs text-slate-500 mt-1">click a row to focus. toggle approved for validation exports.</div>

            <div className="mt-3 space-y-2 max-h-[420px] overflow-auto pr-1">
              {anns.map((a, i) => {
                const cls = classById[a.class_id]
                const selected = i === selectedIdx
                return (
                  <div
                    key={i}
                    className={cx(
                      "border rounded-2xl p-3 cursor-pointer flex flex-col gap-1 transition-colors",
                      selected ? "border-blue-300 bg-blue-50/60" : "border-blue-200 bg-white hover:bg-blue-50/30"
                    )}
                    onClick={() => setSelectedIdx(i)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-6 rounded-full" style={{ backgroundColor: cls?.color || "#22c55e" }} />
                        <div className="font-medium text-slate-900">{cls?.name || a.class_id}</div>
                      </div>

                      <button
                        className={cx(
                          "text-xs px-2 py-1 rounded-full border transition-colors",
                          a.approved ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleApproved(i)
                        }}
                      >
                        {a.approved ? "approved" : "unapproved"}
                      </button>
                    </div>

                    <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-2">
                      <span>x {a.x.toFixed(0)}</span>
                      <span>y {a.y.toFixed(0)}</span>
                      <span>w {a.w.toFixed(0)}</span>
                      <span>h {a.h.toFixed(0)}</span>
                      {a.confidence != null && <span>conf {(a.confidence * 100).toFixed(0)}%</span>}
                    </div>

                    {selected && (
                      <div className="mt-2">
                        <textarea
                          className="w-full border border-blue-200 rounded-xl px-2 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
                          placeholder="comment / QA note…"
                          value={a.attributes?.note || ""}
                          onChange={(e) => {
                            const value = e.target.value
                            applyChange((arr) =>
                              arr.map((ann, idx) =>
                                idx === i ? { ...ann, attributes: { ...(ann.attributes || {}), note: value } } : ann
                              )
                            )
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {!anns.length && (
                <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  no boxes yet. drag on canvas to create one.
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 border-t border-blue-100/70 pt-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-900">hotkeys</div>
            <ul className="list-disc ml-4 mt-2 space-y-1">
              <li>ctrl+s save</li>
              <li>left/right switch image</li>
              <li>b draw • v select • space pan</li>
              <li>1..9 select class</li>
              <li>del delete selected box</li>
              <li>w a s d nudge selected box (shift bigger)</li>
              <li>mouse wheel zoom</li>
              <li>double click to finish polygon</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
