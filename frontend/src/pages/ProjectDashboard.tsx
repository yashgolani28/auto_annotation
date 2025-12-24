import React, { useEffect, useMemo, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api } from "../api"
import { useAuth } from "../state/auth"
import { useToast } from "../components/Toast"

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Dataset = { id: number; name: string; project_id: number }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type Member = { user_id: number; email: string; name: string; role: string }
type ASet = { id: number; name: string; source: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

function Section({
  title,
  subtitle,
  children,
  right,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white/80 border border-blue-100/70 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

export default function ProjectDashboard() {
  const { id } = useParams()
  const projectId = Number(id)
  const { user } = useAuth()
  const { showToast } = useToast()

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
  const [loading, setLoading] = useState(false)

  const [importSetId, setImportSetId] = useState<number>(0)
  const [importDatasetId, setImportDatasetId] = useState<number>(0)
  const [importFile, setImportFile] = useState<File | null>(null)

  const canAdmin = useMemo(() => user?.role === "admin", [user?.role])

  async function refresh() {
    try {
      setLoading(true)
      const [c, d, m, mem, s] = await Promise.all([
        api.get(`/api/projects/${projectId}/classes`),
        api.get(`/api/projects/${projectId}/datasets`),
        api.get(`/api/projects/${projectId}/models`),
        api.get(`/api/projects/${projectId}/members`),
        api.get(`/api/projects/${projectId}/annotation-sets`),
      ])
      setClasses(c.data)
      setDatasets(d.data)
      setModels(m.data)
      setMembers(mem.data)
      setSets(s.data)
      if (!importSetId && s.data.length) setImportSetId(s.data[0].id)
      if (!importDatasetId && d.data.length) setImportDatasetId(d.data[0].id)
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "failed to load data", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function saveClasses() {
    try {
      const lines = classText
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)

      if (lines.length === 0) {
        showToast("please enter at least one class", "error")
        return
      }

      const palette = [
        "#ef4444",
        "#22c55e",
        "#3b82f6",
        "#eab308",
        "#a855f7",
        "#14b8a6",
        "#f97316",
        "#06b6d4",
        "#84cc16",
        "#ec4899",
      ]

      const payload = lines.map((name, idx) => ({ name, color: palette[idx % palette.length] }))
      await api.post(`/api/projects/${projectId}/classes`, payload)
      showToast(`saved ${lines.length} classes`, "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "failed to save classes", "error")
    }
  }

  async function createDataset() {
    const nm = datasetName.trim()
    if (!nm) {
      showToast("dataset name required", "error")
      throw new Error("dataset name required")
    }
    const r = await api.post(`/api/projects/${projectId}/datasets`, { name: nm })
    return r.data as Dataset
  }

  async function uploadZip() {
    if (!zipFile) {
      showToast("please select a zip file", "error")
      return
    }
    try {
      const ds = await createDataset()
      const form = new FormData()
      form.append("file", zipFile)
      const r = await api.post(`/api/datasets/${ds.id}/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      showToast(`uploaded ${r.data.added || 0} images`, "success")
      setZipFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "upload failed", "error")
    }
  }

  async function uploadModel() {
    if (!modelFile) {
      showToast("please select a model file", "error")
      return
    }
    try {
      const form = new FormData()
      form.append("name", modelName)
      form.append("file", modelFile)
      await api.post(`/api/projects/${projectId}/models`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      showToast("model uploaded", "success")
      setModelFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "model upload failed", "error")
    }
  }

  async function addMember() {
    if (!memberEmail.trim()) {
      showToast("member email required", "error")
      return
    }
    try {
      await api.post(`/api/projects/${projectId}/members`, { email: memberEmail.trim(), role: memberRole })
      showToast("member added", "success")
      setMemberEmail("")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "failed to add member", "error")
    }
  }

  async function doRandomSplit(datasetId: number) {
    try {
      const r = await api.post(`/api/datasets/${datasetId}/split/random`, {
        train: 0.8,
        val: 0.1,
        test: 0.1,
        seed: splitSeed,
      })
      showToast(`split updated for ${r.data.count || 0} items`, "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "split failed", "error")
    }
  }

  async function importYolo() {
    if (!importFile) {
      showToast("select a yolo zip or coco json", "error")
      return
    }
    try {
      const form = new FormData()
      form.append("file", importFile)
      await api.post(
        `/api/projects/${projectId}/imports/yolo?dataset_id=${importDatasetId}&annotation_set_id=${importSetId}`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )
      showToast("yolo labels imported", "success")
      setImportFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "import failed", "error")
    }
  }

  async function importCoco() {
    if (!importFile) {
      showToast("select a yolo zip or coco json", "error")
      return
    }
    try {
      const form = new FormData()
      form.append("file", importFile)
      await api.post(
        `/api/projects/${projectId}/imports/coco?dataset_id=${importDatasetId}&annotation_set_id=${importSetId}`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )
      showToast("coco labels imported", "success")
      setImportFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "import failed", "error")
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">project dashboard</div>
          <div className="text-sm text-slate-500 mt-1">setup, datasets, members, imports</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            to={`/project/${projectId}/annotate`}
          >
            annotate
          </Link>
          <Link
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            to={`/project/${projectId}/auto`}
          >
            auto
          </Link>
          <Link
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            to={`/project/${projectId}/export`}
          >
            export
          </Link>
          <Link
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            to={`/project/${projectId}/jobs`}
          >
            jobs
          </Link>
          <button
            className={cx(
              "px-4 py-2 rounded-xl border transition-colors",
              loading ? "bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed" : "bg-white hover:bg-slate-50 border-slate-200"
            )}
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "loading..." : "refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <Section
          title="classes"
          subtitle="one per line"
          right={
            <button
              className="rounded-xl px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              onClick={saveClasses}
            >
              save
            </button>
          }
        >
          <textarea
            className="w-full border border-slate-200 rounded-2xl p-3 min-h-[150px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={classText}
            onChange={(e) => setClassText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map((c) => (
              <span
                key={c.id}
                className="px-3 py-1 text-xs rounded-full border border-slate-200 bg-white/80 text-slate-800"
              >
                {c.name}
              </span>
            ))}
          </div>
        </Section>

        <Section title="dataset upload" subtitle="zip of images">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 flex-1"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
            />
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white"
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
            />
            <button
              className="rounded-xl px-4 py-2 font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              onClick={uploadZip}
            >
              upload
            </button>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-900">datasets</div>
            <div className="mt-2 grid gap-2">
              {datasets.map((d) => (
                <div
                  key={d.id}
                  className="border border-slate-200 rounded-2xl p-4 bg-white/70 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{d.name}</div>
                    <div className="text-xs text-slate-500 mt-1">id {d.id}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">seed</span>
                      <input
                        className="border border-slate-200 rounded-xl px-2 py-1 w-24 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                        type="number"
                        value={splitSeed}
                        onChange={(e) => setSplitSeed(Number(e.target.value))}
                      />
                    </div>

                    <button
                      className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                      onClick={() => doRandomSplit(d.id)}
                    >
                      random split
                    </button>

                    {canAdmin && (
                      <button
                        className="rounded-xl px-3 py-2 text-sm font-medium bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
                        onClick={async () => {
                          const ok = confirm(`delete dataset "${d.name}" and all its items? this cannot be undone.`)
                          if (!ok) return
                          try {
                            await api.delete(`/api/datasets/${d.id}`)
                            showToast("dataset deleted", "success")
                            refresh()
                          } catch (err: any) {
                            showToast(err?.response?.data?.detail || "failed to delete dataset", "error")
                          }
                        }}
                      >
                        delete
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {!datasets.length && (
                <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  no datasets yet.
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section title="models" subtitle="upload .pt or .onnx weights">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 flex-1"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white"
              type="file"
              accept=".pt,.onnx"
              onChange={(e) => setModelFile(e.target.files?.[0] || null)}
            />
            <button
              className="rounded-xl px-4 py-2 font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              onClick={uploadModel}
            >
              upload
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {models.map((m) => (
              <div key={m.id} className="border border-slate-200 rounded-2xl p-4 bg-white/70">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      id {m.id} • {m.framework}
                    </div>
                  </div>

                  {canAdmin && (
                    <button
                      className="rounded-xl px-3 py-2 text-xs font-medium bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
                      onClick={async () => {
                        const ok = confirm(`delete model "${m.name}"? this cannot be undone.`)
                        if (!ok) return
                        try {
                          await api.delete(`/api/models/${m.id}`)
                          showToast("model deleted", "success")
                          refresh()
                        } catch (err: any) {
                          showToast(err?.response?.data?.detail || "failed to delete model", "error")
                        }
                      }}
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!models.length && (
              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                no models uploaded yet.
              </div>
            )}
          </div>
        </Section>

        <Section title="members" subtitle="project access control">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 flex-1"
              placeholder="user email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
            />
            <select
              className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
            >
              <option value="annotator">annotator</option>
              <option value="reviewer">reviewer</option>
              <option value="viewer">viewer</option>
            </select>
            <button
              className="rounded-xl px-4 py-2 font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              onClick={addMember}
            >
              add
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="border border-slate-200 rounded-2xl p-4 bg-white/70 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{m.email}</div>
                  <div className="text-xs text-slate-500 mt-1">{m.name}</div>
                </div>
                <span className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  {m.role}
                </span>
              </div>
            ))}

            {!members.length && (
              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                no members yet.
              </div>
            )}
          </div>
        </Section>

        <div className="xl:col-span-2">
          <Section title="import labels" subtitle="import yolo zip (txt) or coco json">
            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={importDatasetId}
                onChange={(e) => setImportDatasetId(Number(e.target.value))}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    dataset {d.id}: {d.name}
                  </option>
                ))}
              </select>

              <select
                className="border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={importSetId}
                onChange={(e) => setImportSetId(Number(e.target.value))}
              >
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    aset {s.id}: {s.name} ({s.source})
                  </option>
                ))}
              </select>

              <input
                className="border border-slate-200 rounded-xl px-3 py-2 bg-white"
                type="file"
                accept=".zip,.json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />

              <button
                className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                onClick={importYolo}
              >
                import yolo zip
              </button>

              <button
                className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                onClick={importCoco}
              >
                import coco json
              </button>
            </div>

            {!datasets.length && (
              <div className="mt-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                upload a dataset first to enable imports.
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
