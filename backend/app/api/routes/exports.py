from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
import shutil

from app.db.session import get_db
from app.models.models import ExportBundle, Dataset, DatasetItem, Annotation, LabelClass, AnnotationSet
from app.schemas.schemas import ExportRequest, ExportOut
from app.services.storage import ensure_dirs, exports_dir
from app.services.export_formats import yolo_export_bundle, coco_export_bundle
from app.core.config import settings

router = APIRouter()

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
