import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, mediaUrl } from '../api'
import { Stage, Layer, Rect, Image as KImage, Transformer } from 'react-konva'
import useImage from 'use-image'

type Dataset = { id: number; name: string }
type Item = { id: number; file_name: string; width: number; height: number; split: string }
type LabelClass = { id: number; name: string; color: string; order_index: number }
type ASet = { id: number; name: string; source: string }
type Ann = { id?: number; class_id: number; x: number; y: number; w: number; h: number; confidence?: number | null; approved: boolean }

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export default function Annotate() {
  const { id } = useParams()
  const projectId = Number(id)

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [sets, setSets] = useState<ASet[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [setId, setSetId] = useState<number>(0)
  const [itemIdx, setItemIdx] = useState<number>(0)

  const [selectedClassId, setSelectedClassId] = useState<number>(0)
  const [anns, setAnns] = useState<Ann[]>([])
  const [selectedAnnIdx, setSelectedAnnIdx] = useState<number | null>(null)

  const currentItem = items[itemIdx]
  const imgSrc = currentItem ? mediaUrl(currentItem.id) : ''
  const [img] = useImage(imgSrc, 'anonymous')

  const stageRef = useRef<any>(null)
  const trRef = useRef<any>(null)
  const [scale, setScale] = useState(1)

  const [isDrawing, setIsDrawing] = useState(false)
  const [draft, setDraft] = useState<Ann | null>(null)
  const [dragStart, setDragStart] = useState<{x:number;y:number} | null>(null)

  async function refreshBase() {
    const [d, c, s] = await Promise.all([
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/classes`),
      api.get(`/api/projects/${projectId}/annotation-sets`)
    ])
    setDatasets(d.data)
    setClasses(c.data)
    setSets(s.data)
    if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
    if (!setId && s.data.length) setSetId(s.data[0].id)
    if (!selectedClassId && c.data.length) setSelectedClassId(c.data[0].id)
  }

  async function refreshItems(dsId: number) {
    const r = await api.get(`/api/datasets/${dsId}/items`)
    setItems(r.data)
    setItemIdx(0)
  }

  async function loadAnnotations(itemId: number, asetId: number) {
    const r = await api.get(`/api/items/${itemId}/annotations`, { params: { annotation_set_id: asetId } })
    setAnns(r.data.map((a: any) => ({ ...a })))
    setSelectedAnnIdx(null)
  }

  useEffect(() => { if (projectId) refreshBase() }, [projectId])

  useEffect(() => {
    if (datasetId) refreshItems(datasetId)
  }, [datasetId])

  useEffect(() => {
    if (currentItem && setId) loadAnnotations(currentItem.id, setId)
  }, [currentItem?.id, setId])

  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    if (selectedAnnIdx === null) {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const node = stage.findOne(`#ann_${selectedAnnIdx}`)
    if (node) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selectedAnnIdx, anns.length, currentItem?.id])

  function canvasToImageCoords(pos: {x:number;y:number}) {
    const s = scale || 1
    return { x: pos.x / s, y: pos.y / s }
  }

  function onMouseDown(e: any) {
    if (!currentItem) return
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    if (!p) return
    const { x, y } = canvasToImageCoords(p)

    if (e.target === stage) {
      setSelectedAnnIdx(null)
      setIsDrawing(true)
      setDragStart({ x, y })
      setDraft({ class_id: selectedClassId, x, y, w: 1, h: 1, approved: false })
    }
  }

  function onMouseMove(e: any) {
    if (!isDrawing || !dragStart || !draft || !currentItem) return
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    if (!p) return
    const { x, y } = canvasToImageCoords(p)

    const x0 = dragStart.x
    const y0 = dragStart.y
    const nx = Math.min(x0, x)
    const ny = Math.min(y0, y)
    const nw = Math.abs(x - x0)
    const nh = Math.abs(y - y0)
    setDraft({ ...draft, x: nx, y: ny, w: nw, h: nh })
  }

  function onMouseUp() {
    if (!isDrawing || !draft || !currentItem) {
      setIsDrawing(false); setDragStart(null); setDraft(null)
      return
    }
    setIsDrawing(false)
    setDragStart(null)

    if (draft.w < 4 || draft.h < 4) {
      setDraft(null)
      return
    }

    const x = clamp(draft.x, 0, currentItem.width - 1)
    const y = clamp(draft.y, 0, currentItem.height - 1)
    const w = clamp(draft.w, 0, currentItem.width - x)
    const h = clamp(draft.h, 0, currentItem.height - y)

    setAnns(prev => [...prev, { ...draft, x, y, w, h }])
    setDraft(null)
  }

  function onSelect(idx: number) {
    setSelectedAnnIdx(idx)
  }

  function deleteSelected() {
    if (selectedAnnIdx === null) return
    setAnns(prev => prev.filter((_, i) => i !== selectedAnnIdx))
    setSelectedAnnIdx(null)
  }

  async function save() {
    if (!currentItem) return
    await api.put(`/api/items/${currentItem.id}/annotations`, anns, { params: { annotation_set_id: setId } })
    alert('saved')
    loadAnnotations(currentItem.id, setId)
  }

  function onTransformEnd(idx: number, e: any) {
    if (!currentItem) return
    const node = e.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)

    const x = clamp(node.x(), 0, currentItem.width - 1)
    const y = clamp(node.y(), 0, currentItem.height - 1)
    const w = clamp(node.width() * scaleX, 1, currentItem.width - x)
    const h = clamp(node.height() * scaleY, 1, currentItem.height - y)

    setAnns(prev => prev.map((a, i) => i === idx ? { ...a, x, y, w, h } : a))
  }

  function onDragEnd(idx: number, e: any) {
    if (!currentItem) return
    const node = e.target
    const x = clamp(node.x(), 0, currentItem.width - 1)
    const y = clamp(node.y(), 0, currentItem.height - 1)
    setAnns(prev => prev.map((a, i) => i === idx ? { ...a, x, y } : a))
  }

  function next() { if (items.length) setItemIdx(i => clamp(i + 1, 0, items.length - 1)) }
  function prev() { if (items.length) setItemIdx(i => clamp(i - 1, 0, items.length - 1)) }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAnnIdx, items.length, currentItem?.id, anns])

  const stageMaxW = 1100
  const stageMaxH = 720
  useEffect(() => {
    if (!currentItem) return
    const s = Math.min(stageMaxW / currentItem.width, stageMaxH / currentItem.height)
    setScale(s)
  }, [currentItem?.id])

  return (
    <div style={{ padding: 16 }}>
      <h2>annotate</h2>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label>dataset</label>
        <select value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
          {datasets.map(d => <option key={d.id} value={d.id}>{d.id}: {d.name}</option>)}
        </select>

        <label>annotation set</label>
        <select value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
          {sets.map(s => <option key={s.id} value={s.id}>{s.id}: {s.name} ({s.source})</option>)}
        </select>

        <label>active class</label>
        <select value={selectedClassId} onChange={(e) => setSelectedClassId(Number(e.target.value))}>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <button onClick={prev}>prev</button>
        <button onClick={next}>next</button>
        <button onClick={save}>save</button>
        <button onClick={deleteSelected}>delete</button>

        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {currentItem ? `item ${itemIdx+1}/${items.length} • ${currentItem.file_name}` : 'no items'}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>shortcuts: draw by drag, del removes, arrows nav, ctrl+s saves</span>
      </div>

      {currentItem && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ border: '1px solid #eee', padding: 8 }}>
            <Stage
              width={currentItem.width * scale}
              height={currentItem.height * scale}
              ref={stageRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              <Layer scaleX={scale} scaleY={scale}>
                <KImage image={img as any} x={0} y={0} width={currentItem.width} height={currentItem.height} />
                {anns.map((a, idx) => {
                  const color = classes.find(c => c.id === a.class_id)?.color || '#22c55e'
                  return (
                    <Rect
                      key={idx}
                      id={`ann_${idx}`}
                      x={a.x}
                      y={a.y}
                      width={a.w}
                      height={a.h}
                      stroke={color}
                      strokeWidth={2}
                      draggable
                      onClick={() => onSelect(idx)}
                      onTap={() => onSelect(idx)}
                      onDragEnd={(e) => onDragEnd(idx, e)}
                      onTransformEnd={(e) => onTransformEnd(idx, e)}
                    />
                  )
                })}
                {draft && (
                  <Rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} stroke="#3b82f6" strokeWidth={2} dash={[6, 4]} />
                )}
                <Transformer
                  ref={trRef}
                  rotateEnabled={false}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 5 || newBox.height < 5) return oldBox
                    return newBox
                  }}
                />
              </Layer>
            </Stage>
          </div>

          <div style={{ width: 320, border: '1px solid #eee', padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>boxes</div>
            <div style={{ display: 'grid', gap: 8, maxHeight: 520, overflow: 'auto' }}>
              {anns.map((a, idx) => {
                const clsName = classes.find(c => c.id === a.class_id)?.name || String(a.class_id)
                const selected = idx === selectedAnnIdx
                return (
                  <div key={idx} style={{ border: selected ? '2px solid #111' : '1px solid #ddd', padding: 8 }} onClick={() => onSelect(idx)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{clsName}</div>
                      <label style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={a.approved}
                          onChange={(e) => setAnns(prev => prev.map((x, i) => i === idx ? { ...x, approved: e.target.checked } : x))}
                        />
                        approved
                      </label>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      x {a.x.toFixed(1)} y {a.y.toFixed(1)} w {a.w.toFixed(1)} h {a.h.toFixed(1)}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <select value={a.class_id} onChange={(e) => setAnns(prev => prev.map((x, i) => i === idx ? { ...x, class_id: Number(e.target.value) } : x))}>
                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button onClick={() => { setSelectedAnnIdx(idx); deleteSelected() }}>remove</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
