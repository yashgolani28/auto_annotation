import React, { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api } from "../api"
import { useAuth } from "../state/auth"

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Dataset = { id: number; name: string; project_id: number }
type Model = { id: number; name: string; framework: string; class_names: Record<string,string> }
type Member = { user_id: number; email: string; name: string; role: string }
type ASet = { id: number; name: string; source: string }

export default function ProjectDashboard() {
  const { id } = useParams()
  const projectId = Number(id)
  const { user } = useAuth()

  const [classes, setClasses] = useState<LabelClass[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [sets, setSets] = useState<ASet[]>([])

  const [classText, setClassText] = useState("car\ntruck\nbus")
  const [datasetName, setDatasetName] = useState("dataset1")
  const [zipFile, setZipFile] = useState<File | null>(null)

  const [modelName, setModelName] = useState("detector")
  const [modelFile, setModelFile] = useState<File | null>(null)

  const [memberEmail, setMemberEmail] = useState("")
  const [memberRole, setMemberRole] = useState("annotator")

  const [splitSeed, setSplitSeed] = useState(42)

  const [importSetId, setImportSetId] = useState<number>(0)
  const [importDatasetId, setImportDatasetId] = useState<number>(0)
  const [importFile, setImportFile] = useState<File | null>(null)

  async function refresh() {
    const [c, d, m, mem, s] = await Promise.all([
      api.get(`/api/projects/${projectId}/classes`),
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/models`),
      api.get(`/api/projects/${projectId}/members`),
      api.get(`/api/projects/${projectId}/annotation-sets`)
    ])
    setClasses(c.data)
    setDatasets(d.data)
    setModels(m.data)
    setMembers(mem.data)
    setSets(s.data)
    if (!importSetId && s.data.length) setImportSetId(s.data[0].id)
    if (!importDatasetId && d.data.length) setImportDatasetId(d.data[0].id)
  }

  useEffect(() => { if (projectId) refresh() }, [projectId])

  async function saveClasses() {
    const lines = classText.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
    const payload = lines.map((name) => ({ name, color: "#22c55e" }))
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
    form.append("file", zipFile)
    await api.post(`/api/datasets/${ds.id}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } })
    alert("uploaded")
    refresh()
  }

  async function uploadModel() {
    if (!modelFile) return
    const form = new FormData()
    form.append("name", modelName)
    form.append("file", modelFile)
    await api.post(`/api/projects/${projectId}/models`, form, { headers: { "Content-Type": "multipart/form-data" } })
    alert("model uploaded")
    refresh()
  }

  async function addMember() {
    await api.post(`/api/projects/${projectId}/members`, { email: memberEmail, role: memberRole })
    setMemberEmail("")
    refresh()
  }

  async function doRandomSplit(datasetId: number) {
    await api.post(`/api/datasets/${datasetId}/split/random`, { train: 0.8, val: 0.1, test: 0.1, seed: splitSeed })
    alert("split updated")
  }

  async function importYolo() {
    if (!importFile) return
    const form = new FormData()
    form.append("file", importFile)
    await api.post(`/api/projects/${projectId}/imports/yolo?dataset_id=${importDatasetId}&annotation_set_id=${importSetId}`, form, { headers: { "Content-Type": "multipart/form-data" } })
    alert("yolo imported")
  }

  async function importCoco() {
    if (!importFile) return
    const form = new FormData()
    form.append("file", importFile)
    await api.post(`/api/projects/${projectId}/imports/coco?dataset_id=${importDatasetId}&annotation_set_id=${importSetId}`, form, { headers: { "Content-Type": "multipart/form-data" } })
    alert("coco imported")
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">project dashboard</div>
          <div className="text-sm text-zinc-500">setup, datasets, members, imports</div>
        </div>
        <div className="flex gap-2">
          <Link className="px-4 py-2 rounded-lg bg-white border" to={`/project/${projectId}/annotate`}>annotate</Link>
          <Link className="px-4 py-2 rounded-lg bg-white border" to={`/project/${projectId}/auto`}>auto</Link>
          <Link className="px-4 py-2 rounded-lg bg-white border" to={`/project/${projectId}/export`}>export</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">classes</div>
          <div className="text-xs text-zinc-500 mt-1">one per line</div>
          <textarea className="mt-3 w-full border rounded-xl p-3 min-h-[150px]" value={classText} onChange={(e)=>setClassText(e.target.value)} />
          <button className="mt-3 bg-zinc-900 text-white rounded-lg px-4 py-2" onClick={saveClasses}>save classes</button>
          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map(c => <span key={c.id} className="px-3 py-1 text-xs rounded-full bg-zinc-100">{c.name}</span>)}
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">dataset upload</div>
          <div className="text-xs text-zinc-500 mt-1">zip of images</div>
          <div className="mt-3 flex gap-2">
            <input className="border rounded-lg px-3 py-2 flex-1" value={datasetName} onChange={(e)=>setDatasetName(e.target.value)} />
            <input className="border rounded-lg px-3 py-2" type="file" accept=".zip" onChange={(e)=>setZipFile(e.target.files?.[0] || null)} />
            <button className="bg-zinc-900 text-white rounded-lg px-4" onClick={uploadZip}>upload</button>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold">datasets</div>
            <div className="mt-2 grid gap-2">
              {datasets.map(d => (
                <div key={d.id} className="border rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-zinc-500">id {d.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input className="border rounded-lg px-2 py-1 w-20 text-sm" type="number" value={splitSeed} onChange={(e)=>setSplitSeed(Number(e.target.value))} />
                    <button className="border rounded-lg px-3 py-1 text-sm" onClick={() => doRandomSplit(d.id)}>random split</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">models</div>
          <div className="text-xs text-zinc-500 mt-1">upload .pt weights</div>
          <div className="mt-3 flex gap-2">
            <input className="border rounded-lg px-3 py-2 flex-1" value={modelName} onChange={(e)=>setModelName(e.target.value)} />
            <input className="border rounded-lg px-3 py-2" type="file" accept=".pt,.onnx" onChange={(e)=>setModelFile(e.target.files?.[0] || null)} />
            <button className="bg-zinc-900 text-white rounded-lg px-4" onClick={uploadModel}>upload</button>
          </div>
          <div className="mt-3 grid gap-2">
            {models.map(m => (
              <div key={m.id} className="border rounded-xl p-3">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-zinc-500">id {m.id} • {m.framework}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">members</div>
          <div className="text-xs text-zinc-500 mt-1">project access control</div>
          <div className="mt-3 flex gap-2">
            <input className="border rounded-lg px-3 py-2 flex-1" placeholder="user email" value={memberEmail} onChange={(e)=>setMemberEmail(e.target.value)} />
            <select className="border rounded-lg px-3 py-2" value={memberRole} onChange={(e)=>setMemberRole(e.target.value)}>
              <option value="annotator">annotator</option>
              <option value="reviewer">reviewer</option>
              <option value="viewer">viewer</option>
            </select>
            <button className="bg-zinc-900 text-white rounded-lg px-4" onClick={addMember}>add</button>
          </div>
          <div className="mt-3 grid gap-2">
            {members.map(m => (
              <div key={m.user_id} className="border rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{m.email}</div>
                  <div className="text-xs text-zinc-500">{m.name}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-zinc-100">{m.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4 xl:col-span-2">
          <div className="font-semibold">import labels</div>
          <div className="text-xs text-zinc-500 mt-1">import yolo labels zip (txt) or coco json</div>

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <select className="border rounded-lg px-3 py-2" value={importDatasetId} onChange={(e)=>setImportDatasetId(Number(e.target.value))}>
              {datasets.map(d => <option key={d.id} value={d.id}>dataset {d.id}: {d.name}</option>)}
            </select>
            <select className="border rounded-lg px-3 py-2" value={importSetId} onChange={(e)=>setImportSetId(Number(e.target.value))}>
              {sets.map(s => <option key={s.id} value={s.id}>aset {s.id}: {s.name} ({s.source})</option>)}
            </select>
            <input className="border rounded-lg px-3 py-2" type="file" accept=".zip,.json" onChange={(e)=>setImportFile(e.target.files?.[0] || null)} />
            <button className="border rounded-lg px-4 py-2" onClick={importYolo}>import yolo zip</button>
            <button className="border rounded-lg px-4 py-2" onClick={importCoco}>import coco json</button>
          </div>
        </div>
      </div>
    </div>
  )
}
