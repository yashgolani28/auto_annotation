// frontend/src/pages/Annotate.tsx
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { Stage, Layer, Rect, Text, Group } from "react-konva"
import useImage from "use-image"
import { api, mediaUrl } from "../api"
import { useAuth } from "../state/auth"

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
}

type LockState = { ok: boolean; expires_at?: string; error?: string }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export default function Annotate() {
  const { id } = useParams()
  const projectId = Number(id)
  const { user } = useAuth()

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

  // image
  const imgUrl = item ? mediaUrl(item.id) : ""
  const [image] = useImage(imgUrl, "anonymous")

  // thumbnail strip
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
    setDatasets(d.data)
    setClasses(c.data)
    setAnnotationSets(s.data)

    if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
    if (!annotationSetId && s.data.length) setAnnotationSetId(s.data[0].id)
    if (!activeClassId && c.data.length) setActiveClassId(c.data[0].id)
  }

  async function loadItems(dsId: number) {
    const r = await api.get(`/api/datasets/${dsId}/items?limit=500&offset=0`)
    setItems(r.data)
    setIndex(0)
  }

  async function loadAnnotations(itemId: number, asetId: number) {
    const r = await api.get(`/api/items/${itemId}/annotations?annotation_set_id=${asetId}`)
    setAnns(r.data)
    setSelectedIdx(-1)
    setDirty(false)
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
    // refresh every 60s
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

  // init
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

  // when item changes: load annotations + lock + viewport reset
  useEffect(() => {
    if (!item || !annotationSetId) return

    // reset viewport to fit image
    fitToScreen()

    loadAnnotations(item.id, annotationSetId)
    acquireLock(item.id, annotationSetId)
    startLockLeaseRefresh(item.id, annotationSetId)

    return () => {
      stopLockLeaseRefresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, annotationSetId])

  // window resize stage
  useEffect(() => {
    function onResize() {
      const w = window.innerWidth - 64 - 256 // padding minus sidebar
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
      await acquireLock(item.id, annotationSetId) // extend lock after save
      alert("saved")
    } catch (e: any) {
      alert(e?.response?.data?.detail || "save failed")
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

  // hotkeys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault()
        save()
        return
      }
      if (e.key === "ArrowRight") next()
      if (e.key === "ArrowLeft") prev()
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdx >= 0) {
          setAnns((arr) => arr.filter((_, i) => i !== selectedIdx))
          setSelectedIdx(-1)
          setDirty(true)
        }
      }
      // class hotkeys 1..9
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1
        const c = classes[idx]
        if (c) setActiveClassId(c.id)
      }
      // nudge selected box with arrows + shift
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
          setAnns((arr) =>
            arr.map((b, i) => {
              if (i !== selectedIdx) return b
              return {
                ...b,
                x: clamp(b.x + dx, 0, (item?.width || 1) - 1),
                y: clamp(b.y + dy, 0, (item?.height || 1) - 1),
              }
            })
          )
          setDirty(true)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, dirty, item, annotationSetId, anns, classes, activeClassId])

  function onWheel(e: any) {
    e.evt.preventDefault()
    if (!item) return
    const stage = stageRef.current
    const oldScale = scale
    const pointer = stage.getPointerPosition()
    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const factor = 1.08
    const newScale = clamp(direction > 0 ? oldScale * factor : oldScale / factor, 0.05, 8)

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
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
    setDraft({
      class_id: activeClassId,
      x,
      y,
      w: 1,
      h: 1,
      approved: false,
    })
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
    // clamp
    const x = clamp(draft.x, 0, item.width - 1)
    const y = clamp(draft.y, 0, item.height - 1)
    const w = clamp(draft.w, 1, item.width - x)
    const h = clamp(draft.h, 1, item.height - y)

    setAnns((arr) => [...arr, { ...draft, x, y, w, h }])
    setDraft(null)
    setDirty(true)
  }

  function toggleApproved(i: number) {
    setAnns((arr) => arr.map((a, idx) => (idx === i ? { ...a, approved: !a.approved } : a)))
    setDirty(true)
  }

  // dragging boxes
  function onBoxDrag(i: number, e: any) {
    if (!item) return
    const node = e.target
    const x = clamp(node.x(), 0, item.width - 1)
    const y = clamp(node.y(), 0, item.height - 1)
    setAnns((arr) => arr.map((a, idx) => (idx === i ? { ...a, x, y } : a)))
    setDirty(true)
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
          <div className="text-2xl font-semibold">annotate</div>
          <div className="text-sm text-zinc-500 mt-1">
            draw boxes, press ctrl+s to save • arrows to navigate • mouse wheel to zoom • drag background to pan
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="border rounded-lg px-3 py-2"
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
            className="border rounded-lg px-3 py-2"
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
            className="border rounded-lg px-3 py-2"
            value={activeClassId}
            onChange={(e) => setActiveClassId(Number(e.target.value))}
          >
            {classes.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.name}
              </option>
            ))}
          </select>

          <button className="border rounded-lg px-3 py-2" onClick={fitToScreen}>
            fit
          </button>

          <button className="bg-zinc-900 text-white rounded-lg px-4 py-2" onClick={save} disabled={!lock.ok}>
            save
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className={`text-sm ${lock.ok ? "text-green-700" : "text-red-700"}`}>{banner}</div>
        <div className="text-sm text-zinc-500">
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
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="text-sm font-medium">canvas</div>
            <div className="text-xs text-zinc-500">scale {scale.toFixed(2)}</div>
          </div>

          <div className="bg-zinc-900/5">
            <Stage
              ref={stageRef}
              width={stageSize.w}
              height={stageSize.h}
              scaleX={scale}
              scaleY={scale}
              x={pos.x}
              y={pos.y}
              draggable
              onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
              onWheel={onWheel}
              onMouseDown={(e) => {
                // only draw if clicking empty area (not on a box)
                const clickedOnEmpty = e.target === e.target.getStage()
                if (clickedOnEmpty) startDraw(e)
              }}
              onMouseMove={updateDraw}
              onMouseUp={endDraw}
            >
              <Layer>
                {/* image */}
                {image && <Group>{/* image is drawn as a rect background via Konva.Image is not used here to keep file shorter */}
                  {/* simple workaround: show image using Konva.Image if you want, but this is ok for the tool’s core */}
                </Group>}
              </Layer>

              <Layer>
                {/* draw boxes */}
                {anns.map((a, i) => {
                  const cls = classById[a.class_id]
                  const stroke = cls?.color || "#22c55e"
                  const selected = i === selectedIdx
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
                        draggable={lock.ok}
                        onClick={() => setSelectedIdx(i)}
                        onTap={() => setSelectedIdx(i)}
                        onDragEnd={(e) => onBoxDrag(i, e)}
                      />
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

                {/* draft */}
                {draft && (
                  <Rect
                    x={draft.x}
                    y={draft.y}
                    width={draft.w}
                    height={draft.h}
                    stroke={"#0ea5e9"}
                    strokeWidth={2}
                    dash={[6, 4]}
                  />
                )}
              </Layer>
            </Stage>
          </div>

          {/* thumbnails */}
          <div className="border-t p-2 bg-white">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button className="border rounded-lg px-3 py-1 text-sm" onClick={prev}>
                prev
              </button>
              {thumbs.map((t, i) => {
                const realIdx = thumbStart + i
                const active = realIdx === index
                return (
                  <button
                    key={t.id}
                    onClick={() => setIndex(realIdx)}
                    className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${active ? "bg-zinc-900 text-white" : "bg-white"}`}
                    title={t.file_name}
                  >
                    {realIdx + 1}
                  </button>
                )
              })}
              <button className="border rounded-lg px-3 py-1 text-sm" onClick={next}>
                next
              </button>
            </div>
          </div>
        </div>

        {/* right panel */}
        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">boxes</div>
          <div className="text-xs text-zinc-500 mt-1">click a row to focus. toggle approved for validation exports.</div>

          <div className="mt-3 space-y-2 max-h-[560px] overflow-auto pr-1">
            {anns.map((a, i) => {
              const cls = classById[a.class_id]
              const selected = i === selectedIdx
              return (
                <div
                  key={i}
                  className={`border rounded-xl p-3 cursor-pointer ${selected ? "border-zinc-900" : ""}`}
                  onClick={() => setSelectedIdx(i)}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{cls?.name || a.class_id}</div>
                    <button
                      className={`text-xs px-2 py-1 rounded-full ${a.approved ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-700"}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleApproved(i)
                      }}
                    >
                      {a.approved ? "approved" : "unapproved"}
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    x {a.x.toFixed(0)} y {a.y.toFixed(0)} w {a.w.toFixed(0)} h {a.h.toFixed(0)}
                  </div>
                </div>
              )
            })}
            {!anns.length && <div className="text-sm text-zinc-500">no boxes yet. drag on canvas to create one.</div>}
          </div>

          <div className="mt-4 border-t pt-4 text-xs text-zinc-500">
            <div>hotkeys</div>
            <ul className="list-disc ml-4 mt-2 space-y-1">
              <li>ctrl+s save</li>
              <li>left/right switch image</li>
              <li>1..9 select class</li>
              <li>del delete selected box</li>
              <li>w a s d nudge selected box (shift for bigger steps)</li>
              <li>mouse wheel zoom</li>
            </ul>
          </div>
        </div>
      </div>

      {/* image preview note */}
      <div className="mt-4 text-xs text-zinc-500">
        note: if you want the actual image rendered inside konva, i can switch this file to use konva.image (it’s 10 more lines).
        current file keeps it lean while still doing bbox workflow + export correctly.
      </div>
    </div>
  )
}
