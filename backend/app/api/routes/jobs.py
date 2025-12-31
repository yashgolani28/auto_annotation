from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, require_project_access
from app.db.session import get_db
from app.models.models import Job, Project, User
from app.schemas.schemas import AutoAnnotateRequest, JobOut, TrainYoloRequest
from app.workers.celery_app import celery

router = APIRouter()


def _train_base_dir(job_id: int) -> Path:
    return Path(settings.storage_dir) / "trainings" / f"job_{job_id}"


def _safe_rel(p: Path) -> str:
    return str(p).replace("\\", "/")


def _resolve_under(base: Path, rel_path: str) -> Path:
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    if not rel:
        raise HTTPException(status_code=400, detail="path required")
    candidate = (base / rel).resolve()
    base_r = base.resolve()
    if candidate == base_r or base_r not in candidate.parents:
        raise HTTPException(status_code=400, detail="invalid path")
    return candidate


def _guess_run_dir(job: Job, base_dir: Path) -> Path | None:
    try:
        if isinstance(job.payload, dict):
            rel = job.payload.get("_train_run_rel")
            if rel:
                p = (Path(settings.storage_dir) / str(rel)).resolve()
                if p.exists() and p.is_dir():
                    return p
    except Exception:
        pass

    runs_dir = base_dir / "runs"
    if runs_dir.exists():
        dirs = [d for d in runs_dir.iterdir() if d.is_dir()]
        if dirs:
            dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
            return dirs[0]
    return None


def _tail_results_csv(csv_path: Path, limit: int) -> tuple[list[str], list[list[str]]]:
    try:
        if not csv_path.exists():
            return [], []
        lines = csv_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        lines = [ln for ln in lines if ln.strip()]
        if len(lines) < 2:
            return [], []
        cols = [c.strip() for c in lines[0].split(",") if c.strip()]
        data_lines = lines[1:][-max(1, int(limit)):]
        rows: list[list[str]] = []
        for ln in data_lines:
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) < len(cols):
                parts = parts + [""] * (len(cols) - len(parts))
            if len(parts) > len(cols):
                parts = parts[: len(cols)]
            rows.append(parts)
        return cols, rows
    except Exception:
        return [], []


@router.post("/projects/{project_id}/jobs/auto-annotate", response_model=JobOut)
def start_auto_annotate(
    project_id: int,
    req: AutoAnnotateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    job = Job(project_id=project_id, job_type="auto_annotate", status="queued", progress=0.0, payload=req.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    celery.send_task("auto_annotate_task", args=[job.id])
    return job


@router.post("/projects/{project_id}/jobs/train-yolo", response_model=JobOut)
def start_train_yolo(
    project_id: int,
    payload: TrainYoloRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")

    job = Job(
        project_id=project_id,
        job_type="train_yolo",
        status="queued",
        progress=0.0,
        message="queued",
        payload=payload.model_dump(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    celery.send_task("train_yolo_task", args=[job.id])
    return job


@router.get("/projects/{project_id}/jobs", response_model=list[JobOut])
def list_project_jobs(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    return db.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at.desc()).limit(200).all()


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    require_project_access(job.project_id, db, user)
    return job


# ---------------------------------------------------------------------
# Train YOLO: live results.csv + artifacts
# ---------------------------------------------------------------------

@router.get("/jobs/{job_id}/train-yolo/live-csv")
def train_yolo_live_csv(
    job_id: int,
    limit: int = Query(15, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    require_project_access(job.project_id, db, user)

    base_dir = _train_base_dir(job_id)
    run_dir = _guess_run_dir(job, base_dir)
    if not run_dir:
        return {"columns": [], "rows": [], "job_rel_path": None, "updated_at": job.updated_at.isoformat()}

    csv_path = run_dir / "results.csv"
    cols, rows = _tail_results_csv(csv_path, limit=limit)

    job_rel = None
    try:
        if csv_path.exists():
            job_rel = _safe_rel(csv_path.relative_to(base_dir))
    except Exception:
        job_rel = None

    return {
        "columns": cols,
        "rows": rows,
        "job_rel_path": job_rel,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.get("/jobs/{job_id}/train-yolo/summary")
def train_yolo_summary(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    require_project_access(job.project_id, db, user)

    base_dir = _train_base_dir(job_id)
    run_dir = _guess_run_dir(job, base_dir)

    def url(rel: str) -> str:
        rel = rel.replace("\\", "/").lstrip("/")
        return f"/api/jobs/{job_id}/train-yolo/artifact/{rel}"

    out: dict[str, Any] = {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "trained_model_id": None,
        "trained_model_name": None,
        "metrics": None,
        "downloads": [],
        "plots": [],
        "updated_at": (job.updated_at.isoformat() if job.updated_at else None),
        "base_model_check": None,
        "model_check": None,
    }

    if isinstance(job.payload, dict):
        out["trained_model_id"] = job.payload.get("trained_model_id")
        out["trained_model_name"] = job.payload.get("trained_model_name")
        out["metrics"] = job.payload.get("bench_metrics") or job.payload.get("metrics")
        out["base_model_check"] = job.payload.get("base_model_check")
        out["model_check"] = job.payload.get("trained_model_check") or job.payload.get("model_check")

    candidates: list[tuple[str, Path]] = []
    if run_dir:
        candidates.append(("results.csv", run_dir / "results.csv"))
    candidates.extend(
        [
            ("model.pt", base_dir / "artifacts" / "model.pt"),
            ("benchmark_report.docx", base_dir / "artifacts" / "benchmark_report.docx"),
            ("benchmark_report.md", base_dir / "artifacts" / "benchmark_report.md"),
        ]
    )

    for label, p in candidates:
        if p.exists() and p.is_file():
            try:
                rel = _safe_rel(p.relative_to(base_dir))
                out["downloads"].append({"label": label, "job_rel_path": rel, "url": url(rel)})
            except Exception:
                pass

    plot_files: list[Path] = []
    folders = [base_dir / "artifacts", base_dir / "artifacts" / "bench_runs"]
    if run_dir:
        folders.insert(0, run_dir)

    for folder in folders:
        if not folder.exists():
            continue
        for p in folder.rglob("*"):
            if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                plot_files.append(p)

    plot_files = sorted(plot_files, key=lambda p: p.stat().st_mtime, reverse=True)[:12]
    for p in plot_files:
        try:
            rel = _safe_rel(p.relative_to(base_dir))
            out["plots"].append({"name": p.name, "job_rel_path": rel, "url": url(rel)})
        except Exception:
            pass

    return out


@router.get("/jobs/{job_id}/train-yolo/artifact/{rel_path:path}")
def train_yolo_artifact(
    job_id: int,
    rel_path: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    require_project_access(job.project_id, db, user)

    base_dir = _train_base_dir(job_id)
    p = _resolve_under(base_dir, rel_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    return FileResponse(str(p), filename=p.name)
