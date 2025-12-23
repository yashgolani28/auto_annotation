// frontend/src/pages/AutoAnnotate.tsx
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { api, wsJobUrl } from "../api"

type Dataset = { id: number; name: string }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type ASet = { id: number; name: string; source: string }
type LabelClass = { id: number; name: string; color: string; order_index: number }

type Job = { id: number; status: string; progress: number; message: string; updated_at: string }

export default function AutoAnnotate() {
  const { id } = useParams()
  const projectId = Number(id)

  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [sets, setSets] = useState<ASet[]>([])
  const [classes, setClasses] = useState<LabelClass[]>([])

  const [datasetId, setDatasetId] = useState<number>(0)
  const [modelId, setModelId] = useState<number>(0)

  const [conf, setConf] = useState(0.25)
  const [iou, setIou] = useState(0.45)

  // mapping: model_class_name -> project_class_name
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // websocket job
  const [job, setJob] = useState<Job | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const selectedModel = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId])

  const modelClassNames = useMemo(() => {
    if (!selectedModel) return []
    // class_names from backend is a dict like {"0":"car","1":"truck"} or {"0":"person"}
    const entries = Object.entries(selectedModel.class_names || {})
      .map(([k, v]) => ({ idx: Number(k), name: String(v) }))
      .sort((a, b) => a.idx - b.idx)
    return entries
  }, [selectedModel])

  async function refresh() {
    const [d, m, s, c] = await Promise.all([
      api.get(`/api/projects/${projectId}/datasets`),
      api.get(`/api/projects/${projectId}/models`),
      api.get(`/api/projects/${projectId}/annotation-sets`),
      api.get(`/api/projects/${projectId}/classes`)
    ])
    setDatasets(d.data)
    setModels(m.data)
    setSets(s.data)
    setClasses(c.data)

    if (!datasetId && d.data.length) setDatasetId(d.data[0].id)
    if (!modelId && m.data.length) setModelId(m.data[0].id)
  }

  useEffect(() => {
    if (!projectId) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // initialize mapping defaults when model changes
  useEffect(() => {
    if (!selectedModel) return
    const next: Record<string, string> = {}
    for (const mc of modelClassNames) {
      const lower = mc.name.toLowerCase()
      const match = classes.find((c) => c.name.toLowerCase() === lower)
      if (match) next[mc.name] = match.name
      else next[mc.name] = "" // unmapped by default
    }
    setMapping(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, classes.length])

  function setMap(modelName: string, projectName: string) {
    setMapping((m) => ({ ...m, [modelName]: projectName }))
  }

  function connectJobWS(jobId: number) {
    try {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      const ws = new WebSocket(wsJobUrl(jobId))
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.error) return
          setJob(data)
          if (data.status === "success" || data.status === "failed") {
            ws.close()
            wsRef.current = null
          }
        } catch {}
      }
      ws.onerror = () => {}
      ws.onclose = () => {}
    } catch {}
  }

  async function start() {
    if (!datasetId || !modelId) return

    // build class_mapping only for non-empty entries
    const class_mapping: Record<string, string> = {}
    for (const [k, v] of Object.entries(mapping)) {
      if (v && v.trim()) class_mapping[k] = v.trim()
    }

    // create a new annotation set for this run (so runs are reproducible)
    const asetName = `auto_run_${new Date().toISOString().replace(/[:.]/g, "-")}`
    // backend doesn’t expose create-aset endpoint in the earlier patch, so we pass params via job payload;
    // the worker stores them into aset.params already in your v1, and in v2 we rely on that.
    // if your backend expects annotation_set_id, then use the default or first set.
    const annotation_set_id = sets.length ? sets[0].id : 0
    if (!annotation_set_id) {
      alert("no annotation set found (create project again or check backend)")
      return
    }

    const payload = {
      dataset_id: datasetId,
      model_weight_id: modelId,
      annotation_set_id,
      conf,
      iou,
      params: {
        name: asetName,
        class_mapping
      }
    }

    const r = await api.post(`/api/projects/${projectId}/jobs/auto-annotate`, payload)
    const jobId = r.data.job_id || r.data.id || r.data.job?.id
    if (!jobId) {
      alert("job started but no job_id returned")
      return
    }
    setJob({ id: jobId, status: "queued", progress: 0, message: "", updated_at: new Date().toISOString() })
    connectJobWS(jobId)
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold">auto annotate</div>
          <div className="text-sm text-zinc-500 mt-1">map model classes to project labels, run async job, watch live progress</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">inputs</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-zinc-500">dataset</div>
              <select className="mt-1 w-full border rounded-lg px-3 py-2" value={datasetId} onChange={(e)=>setDatasetId(Number(e.target.value))}>
                {datasets.map(d => <option key={d.id} value={d.id}>dataset {d.id}: {d.name}</option>)}
              </select>
            </div>

            <div>
              <div className="text-xs text-zinc-500">model</div>
              <select className="mt-1 w-full border rounded-lg px-3 py-2" value={modelId} onChange={(e)=>setModelId(Number(e.target.value))}>
                {models.map(m => <option key={m.id} value={m.id}>model {m.id}: {m.name}</option>)}
              </select>
            </div>

            <div>
              <div className="text-xs text-zinc-500">conf</div>
              <input className="mt-1 w-full border rounded-lg px-3 py-2" type="number" step="0.01" value={conf} onChange={(e)=>setConf(Number(e.target.value))} />
            </div>

            <div>
              <div className="text-xs text-zinc-500">iou</div>
              <input className="mt-1 w-full border rounded-lg px-3 py-2" type="number" step="0.01" value={iou} onChange={(e)=>setIou(Number(e.target.value))} />
            </div>
          </div>

          <button className="mt-4 bg-zinc-900 text-white rounded-lg px-4 py-2" onClick={start}>
            start auto annotation
          </button>

          {job && (
            <div className="mt-4 border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">job #{job.id}</div>
                <div className={`text-xs px-2 py-1 rounded-full ${
                  job.status === "success" ? "bg-green-100 text-green-700"
                  : job.status === "failed" ? "bg-red-100 text-red-700"
                  : "bg-zinc-100 text-zinc-700"
                }`}>
                  {job.status}
                </div>
              </div>
              <div className="text-xs text-zinc-500 mt-2">{job.message || "—"}</div>
              <div className="mt-2">
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-2 bg-zinc-900" style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
                </div>
                <div className="text-xs text-zinc-500 mt-1">{Math.round((job.progress || 0) * 100)}%</div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold">class mapping</div>
          <div className="text-xs text-zinc-500 mt-1">only mapped classes will be saved. unmapped predictions are ignored.</div>

          <div className="mt-3 grid gap-2 max-h-[520px] overflow-auto pr-1">
            {modelClassNames.length === 0 && (
              <div className="text-sm text-zinc-500">selected model has no readable class_names (or it’s not a .pt ultralytics model)</div>
            )}

            {modelClassNames.map((mc) => (
              <div key={mc.idx} className="border rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{mc.name}</div>
                  <div className="text-xs text-zinc-500">model class {mc.idx}</div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-zinc-500">→</div>
                  <select
                    className="border rounded-lg px-3 py-2"
                    value={mapping[mc.name] || ""}
                    onChange={(e)=>setMap(mc.name, e.target.value)}
                  >
                    <option value="">ignore</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 text-xs text-zinc-500">
            tip: keep project class names consistent with your model labels to reduce manual mapping.
          </div>
        </div>
      </div>
    </div>
  )
}
