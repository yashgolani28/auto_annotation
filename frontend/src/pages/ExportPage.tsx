import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, API_BASE } from '../api'

type Dataset = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type Export = { id: number; fmt: string }

export default function ExportPage() {
  const { id } = useParams()
  const projectId = Number(id)

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [sets, setSets] = useState<ASet[]>([])
  const [datasetId, setDatasetId] = useState<number>(0)
  const [setId, setSetId] = useState<number>(0)
  const [includeImages, setIncludeImages] = useState(true)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [lastExport, setLastExport] = useState<Export | null>(null)

  async function refresh() {
    const [d, s] = await Promise.all([
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/annotation-sets`)
    ])
    setDatasets(d.data)
    setSets(s.data)
    if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
    if (!setId && s.data.length) setSetId(s.data[0].id)
  }

  useEffect(() => { if (projectId) refresh() }, [projectId])

  async function doExport(fmt: 'yolo' | 'coco') {
    const r = await api.post(`/api/projects/${projectId}/exports`, {
      dataset_id: datasetId,
      annotation_set_id: setId,
      fmt,
      include_images: includeImages,
      approved_only: approvedOnly
    })
    setLastExport(r.data)
  }

  function download() {
    if (!lastExport) return
    window.open(`${API_BASE}/api/exports/${lastExport.id}/download`, '_blank')
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2>export</h2>

      <div style={{ display: 'grid', gap: 12, border: '1px solid #eee', padding: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>dataset</label>
          <select value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.id}: {d.name}</option>)}
          </select>

          <label>annotation set</label>
          <select value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
            {sets.map(s => <option key={s.id} value={s.id}>{s.id}: {s.name} ({s.source})</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
          include images
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
          approved only
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => doExport('yolo')}>export yolo zip</button>
          <button onClick={() => doExport('coco')}>export coco zip</button>
          {lastExport && <button onClick={download}>download last export</button>}
        </div>
      </div>

      {lastExport && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          last export: id {lastExport.id} • {lastExport.fmt}
        </div>
      )}
    </div>
  )
}
