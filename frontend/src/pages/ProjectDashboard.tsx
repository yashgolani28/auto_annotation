import React, { useEffect, useMemo, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api } from "../api"
import { useAuth } from "../state/auth"
import { useToast } from "../components/Toast"
import PageHeader from "../components/PageHeader"

type LabelClass = { id: number; name: string; color: string; order_index: number }
type Dataset = { id: number; name: string; project_id: number }
type Model = { id: number; name: string; framework: string; class_names: Record<string, string> }
type Member = { user_id: number; email: string; name: string; role: string }
type ASet = { id: number; name: string; source: string }

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

const UI = {
  card: cx(
    "rounded-3xl p-5 shadow-sm border",
    "bg-white/80 border-blue-100/70",
    "dark:bg-slate-900/60 dark:border-blue-900/40 dark:shadow-none"
  ),
  sectionTitle: "font-semibold text-slate-900 dark:text-slate-100",
  sectionSub: "text-xs text-slate-600 dark:text-slate-300 mt-1",
  label: "text-xs font-medium text-slate-600 dark:text-slate-300",
  input: cx(
    "w-full rounded-xl px-3 py-2 border outline-none transition",
    "bg-white border-blue-200 text-slate-900 placeholder:text-slate-400",
    "focus:ring-2 focus:ring-blue-300 focus:border-blue-300",
    "dark:bg-slate-950/40 dark:border-blue-900/50 dark:text-slate-100 dark:placeholder:text-slate-400",
    "dark:focus:ring-blue-700/40 dark:focus:border-blue-700"
  ),
  textarea: cx(
    "w-full rounded-2xl p-3 border outline-none transition min-h-[150px]",
    "bg-white border-blue-200 text-slate-900 placeholder:text-slate-400",
    "focus:ring-2 focus:ring-blue-300 focus:border-blue-300",
    "dark:bg-slate-950/40 dark:border-blue-900/50 dark:text-slate-100 dark:placeholder:text-slate-400",
    "dark:focus:ring-blue-700/40 dark:focus:border-blue-700"
  ),
  select: cx(
    "rounded-xl px-3 py-2 border outline-none transition",
    "bg-white border-blue-200 text-slate-900",
    "focus:ring-2 focus:ring-blue-300 focus:border-blue-300",
    "dark:bg-slate-950/40 dark:border-blue-900/50 dark:text-slate-100",
    "dark:focus:ring-blue-700/40 dark:focus:border-blue-700"
  ),
  btnPrimary: cx(
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium transition-colors",
    "bg-blue-600 text-white hover:bg-blue-700",
    "dark:bg-blue-500 dark:hover:bg-blue-400"
  ),
  btnSecondary: cx(
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium transition-colors border",
    "bg-white/70 border-blue-200 text-blue-700 hover:bg-blue-50",
    "dark:bg-slate-950/30 dark:border-blue-900/50 dark:text-blue-200 dark:hover:bg-slate-900/60"
  ),
  btnDanger: cx(
    "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 font-medium transition-colors border",
    "bg-red-50 border-red-200 text-red-700 hover:bg-red-100",
    "dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-200 dark:hover:bg-red-950/50"
  ),
  badgeBlue: cx(
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
    "bg-blue-50 text-blue-700 border-blue-200",
    "dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900/60"
  ),
  mutedBox: cx(
    "text-sm rounded-2xl p-4 border",
    "bg-blue-50 text-blue-700 border-blue-200",
    "dark:bg-slate-950/30 dark:text-blue-200 dark:border-blue-900/50"
  ),
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
    <div className={UI.card}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={UI.sectionTitle}>{title}</div>
          {subtitle && <div className={UI.sectionSub}>{subtitle}</div>}
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

  const canAdmin = useMemo(() => user?.role === "admin" || user?.role === "reviewer", [user?.role])

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
      showToast(err?.response?.data?.detail || "Failed to load data.", "error")
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
        showToast("Please enter at least one class.", "error")
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
      showToast(`Saved ${lines.length} classes.`, "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to save classes.", "error")
    }
  }

  async function createDataset() {
    const nm = datasetName.trim()
    if (!nm) {
      showToast("Dataset name is required.", "error")
      throw new Error("dataset name required")
    }
    const r = await api.post(`/api/projects/${projectId}/datasets`, { name: nm })
    return r.data as Dataset
  }

  async function uploadZip() {
    if (!zipFile) {
      showToast("Please select a ZIP file.", "error")
      return
    }
    try {
      const ds = await createDataset()
      const form = new FormData()
      form.append("file", zipFile)
      const r = await api.post(`/api/datasets/${ds.id}/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      showToast(`Uploaded ${r.data.added || 0} images.`, "success")
      setZipFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Upload failed.", "error")
    }
  }

  async function uploadModel() {
    if (!modelFile) {
      showToast("Please select a model file.", "error")
      return
    }
    try {
      const form = new FormData()
      form.append("name", modelName)
      form.append("file", modelFile)
      await api.post(`/api/projects/${projectId}/models`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      showToast("Model uploaded.", "success")
      setModelFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Model upload failed.", "error")
    }
  }

  async function addMember() {
    if (!memberEmail.trim()) {
      showToast("Member email is required.", "error")
      return
    }
    try {
      await api.post(`/api/projects/${projectId}/members`, { email: memberEmail.trim(), role: memberRole })
      showToast("Member added.", "success")
      setMemberEmail("")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Failed to add member.", "error")
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
      showToast(`Split updated for ${r.data.count || 0} items.`, "success")
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Split failed.", "error")
    }
  }

  async function importYolo() {
    if (!importFile) {
      showToast("Select a YOLO ZIP or COCO JSON file.", "error")
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
      showToast("YOLO labels imported.", "success")
      setImportFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Import failed.", "error")
    }
  }

  async function importCoco() {
    if (!importFile) {
      showToast("Select a YOLO ZIP or COCO JSON file.", "error")
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
      showToast("COCO labels imported.", "success")
      setImportFile(null)
      refresh()
    } catch (err: any) {
      showToast(err?.response?.data?.detail || "Import failed.", "error")
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Project dashboard"
        subtitle="Setup, datasets, members, imports"
        backToProjects
        right={
          <>
            <Link className={UI.btnPrimary} to={`/project/${projectId}/annotate`}>
              Annotate
            </Link>
            <Link className={UI.btnSecondary} to={`/project/${projectId}/auto`}>
              Auto annotate
            </Link>
            <Link className={UI.btnSecondary} to={`/project/${projectId}/view-auto`}>
              View auto
            </Link>
            <Link className={UI.btnSecondary} to={`/project/${projectId}/train`}>
              Train YOLO
            </Link>
            <Link className={UI.btnSecondary} to={`/project/${projectId}/export`}>
              Export
            </Link>
            <Link className={UI.btnSecondary} to={`/project/${projectId}/jobs`}>
              Jobs
            </Link>
            <button className={UI.btnSecondary} onClick={refresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section
          title="Classes"
          subtitle="One per line"
          right={
            <button className={UI.btnPrimary} onClick={saveClasses}>
              Save
            </button>
          }
        >
          <textarea className={UI.textarea} value={classText} onChange={(e) => setClassText(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            {classes.map((c) => (
              <div
                key={c.id}
                className={cx(
                  "group relative inline-flex items-center gap-2",
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  "dark:bg-slate-950/30"
                )}
                style={{
                  borderColor: (c.color || "#3b82f6") + "66",
                  backgroundColor: (c.color || "#3b82f6") + "1A",
                  color: c.color || "#1e40af",
                }}
              >
                <span className="truncate">{c.name}</span>
                {canAdmin && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-400 ml-1"
                    onClick={async () => {
                      const ok = confirm(`Delete class "${c.name}"? This cannot be undone.`)
                      if (!ok) return
                      try {
                        await api.delete(`/api/projects/${projectId}/classes/${c.id}`)
                        showToast("Class deleted.", "success")
                        refresh()
                      } catch (err: any) {
                        showToast(err?.response?.data?.detail || "Failed to delete class.", "error")
                      }
                    }}
                    title="Delete class"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Dataset upload" subtitle="ZIP of images">
          <div className="flex flex-col md:flex-row gap-2">
            <input className={UI.input} value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
            <input
              className={UI.input}
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
            />
            <button className={UI.btnPrimary} onClick={uploadZip}>
              Upload
            </button>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Datasets</div>
            <div className="mt-2 grid gap-2">
              {datasets.map((d) => (
                <div
                  key={d.id}
                  className={cx(
                    "rounded-2xl p-4 border flex flex-col md:flex-row md:items-center md:justify-between gap-3",
                    "bg-white/70 border-blue-200",
                    "dark:bg-slate-950/30 dark:border-blue-900/40"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{d.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">ID {d.id}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className={UI.label}>Seed</span>
                      <input
                        className={cx(UI.input, "w-24 py-1.5")}
                        type="number"
                        value={splitSeed}
                        onChange={(e) => setSplitSeed(Number(e.target.value))}
                      />
                    </div>

                    <button className={cx(UI.btnSecondary, "px-3 py-2 text-sm")} onClick={() => doRandomSplit(d.id)}>
                      Random split
                    </button>

                    {canAdmin && (
                      <button
                        className={UI.btnDanger}
                        onClick={async () => {
                          const ok = confirm(`Delete dataset "${d.name}" and all its items? This cannot be undone.`)
                          if (!ok) return
                          try {
                            await api.delete(`/api/datasets/${d.id}`)
                            showToast("Dataset deleted.", "success")
                            refresh()
                          } catch (err: any) {
                            showToast(err?.response?.data?.detail || "Failed to delete dataset.", "error")
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {!datasets.length && <div className={UI.mutedBox}>No datasets yet.</div>}
            </div>
          </div>
        </Section>

        <Section title="Models" subtitle="Upload .pt or .onnx weights">
          <div className="flex flex-col md:flex-row gap-2">
            <input className={UI.input} value={modelName} onChange={(e) => setModelName(e.target.value)} />
            <input
              className={UI.input}
              type="file"
              accept=".pt,.onnx"
              onChange={(e) => setModelFile(e.target.files?.[0] || null)}
            />
            <button className={UI.btnPrimary} onClick={uploadModel}>
              Upload
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {models.map((m) => (
              <div
                key={m.id}
                className={cx(
                  "rounded-2xl p-4 border",
                  "bg-white/70 border-blue-200",
                  "dark:bg-slate-950/30 dark:border-blue-900/40"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{m.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      ID {m.id} • {m.framework}
                    </div>
                  </div>

                  {canAdmin && (
                    <button
                      className={cx(UI.btnDanger, "text-xs")}
                      onClick={async () => {
                        const ok = confirm(`Delete model "${m.name}"? This cannot be undone.`)
                        if (!ok) return
                        try {
                          await api.delete(`/api/models/${m.id}`)
                          showToast("Model deleted.", "success")
                          refresh()
                        } catch (err: any) {
                          showToast(err?.response?.data?.detail || "Failed to delete model.", "error")
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!models.length && <div className={UI.mutedBox}>No models uploaded yet.</div>}
          </div>
        </Section>

        <Section title="Members" subtitle="Project access control">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              className={UI.input}
              placeholder="User email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
            />
            <select className={UI.select} value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
              <option value="annotator">Annotator</option>
              <option value="reviewer">Reviewer</option>
              <option value="viewer">Viewer</option>
            </select>
            <button className={UI.btnPrimary} onClick={addMember}>
              Add
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className={cx(
                  "rounded-2xl p-4 border flex items-center justify-between gap-3",
                  "bg-white/70 border-blue-200",
                  "dark:bg-slate-950/30 dark:border-blue-900/40"
                )}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{m.email}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{m.name}</div>
                </div>
                <span className={UI.badgeBlue}>{m.role}</span>
              </div>
            ))}

            {!members.length && <div className={UI.mutedBox}>No members yet.</div>}
          </div>
        </Section>

        <div className="xl:col-span-2">
          <Section title="Import labels" subtitle="Import YOLO ZIP (txt) or COCO JSON">
            <div className="flex flex-wrap gap-2 items-center">
              <select className={UI.select} value={importDatasetId} onChange={(e) => setImportDatasetId(Number(e.target.value))}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dataset {d.id}: {d.name}
                  </option>
                ))}
              </select>

              <select className={UI.select} value={importSetId} onChange={(e) => setImportSetId(Number(e.target.value))}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    Set {s.id}: {s.name} ({s.source})
                  </option>
                ))}
              </select>

              <input
                className={UI.input}
                type="file"
                accept=".zip,.json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />

              <button className={UI.btnSecondary} onClick={importYolo}>
                Import YOLO ZIP
              </button>

              <button className={UI.btnSecondary} onClick={importCoco}>
                Import COCO JSON
              </button>
            </div>

            {!datasets.length && (
              <div className={cx("mt-4", UI.mutedBox)}>Upload a dataset first to enable imports.</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
