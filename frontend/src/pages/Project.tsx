import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Dataset = { id: number; name: string; project_id: number }
type Model = { id: number; name: string; framework: string; class_names: Record<string,string> }

export default function Project() {
  const { id } = useParams()
  const projectId = Number(id)
  const [classes, setClasses] = useState<LabelClass[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])

  const [classText, setClassText] = useState('car\ntruck\nbus')
  const [datasetName, setDatasetName] = useState('dataset1')
  const [zipFile, setZipFile] = useState<File | null>(null)

  const [modelName, setModelName] = useState('detector')
  const [modelFile, setModelFile] = useState<File | null>(null)

  async function refresh() {
    const [c, d, m] = await Promise.all([
      api.get(`/api/projects/${projectId}/classes`),
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/models`)
    ])
    setClasses(c.data)
    setDatasets(d.data)
    setModels(m.data)
  }

  useEffect(() => { if (projectId) refresh() }, [projectId])

  async function saveClasses() {
    const lines = classText.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
    const payload = lines.map((name) => ({ name, color: '#22c55e' }))
    await api.post(`/api/projects/${projectId}/classes`, payload)
    refresh()
  }

  async function createDataset() {
    const r = await api.post(`/api/projects/${projectId}/datasets`, { name: datasetName.trim() })
    refresh()
    return r.data as Dataset
  }

  async function uploadZip() {
    if (!zipFile) return
    const ds = await createDataset()
    const form = new FormData()
    form.append('file', zipFile)
    await api.post(`/api/datasets/${ds.id}/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    alert('uploaded')
    refresh()
  }

  async function uploadModel() {
    if (!modelFile) return
    const form = new FormData()
    form.append('name', modelName)
    form.append('file', modelFile)
    await api.post(`/api/projects/${projectId}/models`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    alert('model uploaded')
    refresh()
  }

  return (
    <div style={{ padding: 16, maxWidth: 1000 }}>
      <h2>project setup</h2>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={{ border: '1px solid #eee', padding: 12 }}>
          <h3>1) classes</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <textarea value={classText} onChange={(e) => setClassText(e.target.value)} rows={6} />
            <button onClick={saveClasses}>save classes</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {classes.map(c => (
              <span key={c.id} style={{ border: '1px solid #ddd', padding: '2px 8px', borderRadius: 12 }}>
                {c.name}
              </span>
            ))}
          </div>
        </section>

        <section style={{ border: '1px solid #eee', padding: 12 }}>
          <h3>2) upload dataset (zip of images)</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder="dataset name" />
            <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] || null)} />
            <button onClick={uploadZip}>create dataset + upload</button>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>datasets</div>
            {datasets.map(d => <div key={d.id} style={{ fontSize: 13 }}>{d.id}: {d.name}</div>)}
          </div>
        </section>

        <section style={{ border: '1px solid #eee', padding: 12 }}>
          <h3>3) upload pretrained weights</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="model name" />
            <input type="file" accept=".pt,.onnx" onChange={(e) => setModelFile(e.target.files?.[0] || null)} />
            <button onClick={uploadModel}>upload model</button>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>models</div>
            {models.map(m => (
              <div key={m.id} style={{ fontSize: 13 }}>
                {m.id}: {m.name} ({m.framework})
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
