from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
import shutil
import re
from typing import Any

from app.db.session import get_db
from app.models.models import ExportBundle, Dataset, DatasetItem, Annotation, LabelClass, AnnotationSet, Job, ModelWeight
from app.schemas.schemas import ExportRequest, ExportOut
from app.services.storage import ensure_dirs, exports_dir
from app.services.export_formats import yolo_export_bundle, coco_export_bundle
from app.core.config import settings

router = APIRouter()


# ---------------------------
# helpers
# ---------------------------

def _training_artifacts_dir(job_id: int) -> Path:
    return Path(settings.storage_dir) / "trainings" / f"job_{job_id}" / "artifacts"


def _safe_filename(stem: str) -> str:
    s = (stem or "").strip()
    if not s:
        s = "model"
    # keep letters, numbers, underscore, dash, dot and spaces
    s = re.sub(r"[^\w\-\.\s]+", "", s, flags=re.UNICODE)
    s = s.replace(" ", "_").strip("._")
    if not s:
        s = "model"
    return s[:120]


def _resolve_model_report_path(mw: ModelWeight) -> Path | None:
    """Find benchmark report for a trained model (supports old runs too)."""
    storage = Path(settings.storage_dir)

    # 1) Try explicit meta paths (newer)
    meta = mw.meta if isinstance(mw.meta, dict) else {}
    rel = (
        meta.get("benchmark_report_rel_path")
        or (meta.get("bench") or {}).get("report_rel_path")
        or meta.get("benchmark_report_path")
    )
    if isinstance(rel, str) and rel.strip():
        p = (storage / rel).resolve()
        if p.exists() and p.is_file():
            return p

    # 2) Infer from model file location (works for old runs)
    try:
        model_p = (storage / mw.rel_path).resolve()
        if model_p.exists() and model_p.is_file():
            artifacts = model_p.parent  # trainings/job_x/artifacts/
            docx = artifacts / "benchmark_report.docx"
            md = artifacts / "benchmark_report.md"
            if docx.exists() and docx.is_file():
                return docx
            if md.exists() and md.is_file():
                return md
    except Exception:
        pass

    return None


def _is_probably_trained(mw: ModelWeight) -> bool:
    meta = mw.meta if isinstance(mw.meta, dict) else {}
    if meta.get("trained_at"):
        return True
    rel = (mw.rel_path or "").replace("\\", "/")
    if "/trainings/job_" in f"/{rel}":
        return True
    return False


# ---------------------------
# dataset exports (unchanged)
# ---------------------------

@router.post("/projects/{project_id}/exports", response_model=ExportOut)
def create_export(project_id: int, req: ExportRequest, db: Session = Depends(get_db)):
    ds = db.query(Dataset).filter(Dataset.id == req.dataset_id, Dataset.project_id == project_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="dataset not found")
    aset = db.query(AnnotationSet).filter(AnnotationSet.id == req.annotation_set_id, AnnotationSet.project_id == project_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    classes = db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()
    items = db.query(DatasetItem).filter(DatasetItem.dataset_id == req.dataset_id).order_by(DatasetItem.id.asc()).all()

    annotations_by_item = {}
    for it in items:
        q = db.query(Annotation).filter(Annotation.annotation_set_id == req.annotation_set_id, Annotation.dataset_item_id == it.id)
        if req.approved_only:
            q = q.filter(Annotation.approved == True)  # noqa: E712
        annotations_by_item[it.id] = [{"class_id": a.class_id, "x": a.x, "y": a.y, "w": a.w, "h": a.h} for a in q.all()]

    ensure_dirs()
    base = exports_dir() / f"project_{project_id}" / f"dataset_{req.dataset_id}" / f"aset_{req.annotation_set_id}"
    base.mkdir(parents=True, exist_ok=True)

    workdir = base / f"work_{req.fmt.lower()}"
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    items_payload = []
    for it in items:
        abs_path = Path(settings.storage_dir) / it.rel_path
        items_payload.append({
            "id": it.id,
            "file_name": it.file_name,
            "width": it.width,
            "height": it.height,
            "split": it.split,
            "abs_path": str(abs_path),
        })
    classes_payload = [{"id": c.id, "name": c.name} for c in classes]

    fmt = req.fmt.lower()
    if fmt == "yolo":
        zip_path = yolo_export_bundle(workdir, items_payload, classes_payload, annotations_by_item, req.include_images)
    elif fmt == "coco":
        zip_path = coco_export_bundle(workdir, items_payload, classes_payload, annotations_by_item, req.include_images)
    else:
        raise HTTPException(status_code=400, detail="fmt must be yolo or coco")

    rel = str(zip_path.relative_to(Path(settings.storage_dir)))
    exp = ExportBundle(project_id=project_id, dataset_id=req.dataset_id, annotation_set_id=req.annotation_set_id, fmt=fmt, rel_path=rel)
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


@router.get("/exports/{export_id}/download")
def download_export(export_id: int, db: Session = Depends(get_db)):
    exp = db.query(ExportBundle).filter(ExportBundle.id == export_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="export not found")
    path = Path(settings.storage_dir) / exp.rel_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="file missing")
    return FileResponse(str(path), filename=path.name, media_type="application/zip")


# ---------------------------
# legacy: job-based training artifacts (kept)
# ---------------------------

@router.get("/jobs/{job_id}/artifacts")
def list_training_artifacts(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    artifacts = _training_artifacts_dir(job_id)
    model = artifacts / "model.pt"
    report_docx = artifacts / "benchmark_report.docx"
    report_md = artifacts / "benchmark_report.md"

    return {
        "job_id": job_id,
        "model": {
            "available": model.exists(),
            "rel_path": str(model.relative_to(settings.storage_dir)) if model.exists() else None,
        },
        "benchmark_report": {
            "available": report_docx.exists() or report_md.exists(),
            "rel_path": str(
                (report_docx if report_docx.exists() else report_md)
                .relative_to(settings.storage_dir)
            ) if (report_docx.exists() or report_md.exists()) else None,
        },
    }


@router.get("/jobs/{job_id}/artifacts/model")
def download_trained_model(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    path = _training_artifacts_dir(job_id) / "model.pt"
    if not path.exists():
        raise HTTPException(status_code=404, detail="model.pt not found")

    return FileResponse(
        str(path),
        filename=f"job_{job_id}_model.pt",
        media_type="application/octet-stream",
    )


@router.get("/jobs/{job_id}/artifacts/report")
def download_benchmark_report(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    artifacts = _training_artifacts_dir(job_id)
    docx = artifacts / "benchmark_report.docx"
    md = artifacts / "benchmark_report.md"

    if docx.exists():
        return FileResponse(
            str(docx),
            filename=f"job_{job_id}_benchmark_report.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    if md.exists():
        return FileResponse(
            str(md),
            filename=f"job_{job_id}_benchmark_report.md",
            media_type="text/markdown",
        )

    raise HTTPException(status_code=404, detail="benchmark report not found")


# ---------------------------
# NEW: model-based exports (what you asked for)
# ---------------------------

@router.get("/projects/{project_id}/trained-models")
def list_trained_models(project_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ModelWeight)
        .filter(ModelWeight.project_id == project_id)
        .order_by(ModelWeight.uploaded_at.desc())
        .all()
    )

    out: list[dict[str, Any]] = []
    storage = Path(settings.storage_dir)

    for mw in rows:
        if not _is_probably_trained(mw):
            continue

        model_path = (storage / (mw.rel_path or "")).resolve()
        has_model = model_path.exists() and model_path.is_file()

        meta = mw.meta if isinstance(mw.meta, dict) else {}
        bench = meta.get("bench") if isinstance(meta.get("bench"), dict) else None
        trained_at = meta.get("trained_at") or (mw.uploaded_at.isoformat() if mw.uploaded_at else None)

        report_path = _resolve_model_report_path(mw)
        has_report = report_path is not None

        out.append(
            {
                "id": mw.id,
                "name": mw.name,
                "framework": mw.framework,
                "trained_at": trained_at,
                "metrics": bench,
                "has_model": has_model,
                "has_report": has_report,
            }
        )

    return out


@router.get("/projects/{project_id}/trained-models/{model_id}/download/model")
def download_model_by_id(project_id: int, model_id: int, db: Session = Depends(get_db)):
    mw = db.query(ModelWeight).filter(ModelWeight.id == model_id, ModelWeight.project_id == project_id).first()
    if not mw:
        raise HTTPException(status_code=404, detail="model not found")

    path = Path(settings.storage_dir) / mw.rel_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="model file missing")

    stem = _safe_filename(mw.name)
    return FileResponse(
        str(path),
        filename=f"{stem}_model.pt",
        media_type="application/octet-stream",
    )


@router.get("/projects/{project_id}/trained-models/{model_id}/download/report")
def download_report_by_model_id(project_id: int, model_id: int, db: Session = Depends(get_db)):
    mw = db.query(ModelWeight).filter(ModelWeight.id == model_id, ModelWeight.project_id == project_id).first()
    if not mw:
        raise HTTPException(status_code=404, detail="model not found")

    report_path = _resolve_model_report_path(mw)
    if not report_path:
        raise HTTPException(status_code=404, detail="benchmark report not found")

    stem = _safe_filename(mw.name)
    if report_path.suffix.lower() == ".docx":
        return FileResponse(
            str(report_path),
            filename=f"{stem}_benchmark.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    return FileResponse(
        str(report_path),
        filename=f"{stem}_benchmark.md",
        media_type="text/markdown",
    )
