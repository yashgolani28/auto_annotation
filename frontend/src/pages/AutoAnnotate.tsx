import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

type Dataset = { id: number; name: string }
type Model = { id: number; name: string }
type ASet = { id: number; name: string; source: string }
type Job = { id: number; status: string; progress: number; message: string }

export default function AutoAnnotate() {
  const { id } = useParams()
  const projectId = Number(id)

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [sets, setSets] = useState<ASet[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [modelId, setModelId] = useState<number>(0)
  const [setId, setSetId] = useState<number>(0)
  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.5)
  const [job, setJob] = useState<Job | null>(null)

  async function refresh() {
    const [d, m, s] = await Promise.all([
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/models`),
      api.get(`/api/projects/${projectId}/annotation-sets`)
    ])
    setDatasets(d.data)
    setModels(m.data)
    setSets(s.data)
    if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
    if (!modelId && m.data.length) setModelId(m.data[0].id)
    if (!setId && s.data.length) setSetId(s.data[0].id)
  }

  useEffect(() => { if (projectId) refresh() }, [projectId])

  useEffect(() => {
    let t: any = null
    async function poll() {
      if (!job) return
      const r = await api.get(`/api/jobs/${job.id}`)
      setJob(r.data)
      if (['success','failed'].includes(r.data.status)) return
      t = setTimeout(poll, 800)
    }
    poll()
    return () => { if (t) clearTimeout(t) }
  }, [job?.id])

  async function start() {
    if (!datasetId || !modelId) return
    const r = await api.post(`/api/projects/${projectId}/jobs/auto-annotate`, {
      model_id: modelId,
      dataset_id: datasetId,
      annotation_set_id: setId,
      conf,
      iou,
      device: ""
    })
    setJob(r.data)
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2>auto annotate</h2>

      <div style={{ display: 'grid', gap: 10, border: '1px solid #eee', padding: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>dataset</label>
          <select value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.id}: {d.name}</option>)}
          </select>

          <label>model</label>
          <select value={modelId} onChange={(e) => setModelId(Number(e.target.value))}>
            {models.map(m => <option key={m.id} value={m.id}>{m.id}: {m.name}</option>)}
          </select>

          <label>annotation set</label>
          <select value={setId} onChange={(e) => setSetId(Number(e.target.value))}>
            {sets.map(s => <option key={s.id} value={s.id}>{s.id}: {s.name} ({s.source})</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>conf</label>
          <input type="number" step="0.01" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
          <label>iou</label>
          <input type="number" step="0.01" value={iou} onChange={(e) => setIou(Number(e.target.value))} />
          <button onClick={start}>start job</button>
        </div>

        {job && (
          <div style={{ marginTop: 10 }}>
            <div>job {job.id}: <b>{job.status}</b></div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{job.message}</div>
            <progress value={job.progress} max={1} style={{ width: '100%' }} />
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
        note: auto annotate expects model class names to match project classes by name. unmatched classes are ignored.
      </div>
    </div>
  )
}
