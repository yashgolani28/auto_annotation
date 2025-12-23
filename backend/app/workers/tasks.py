from __future__ import annotations
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session

from app.workers.celery_app import celery
from app.db.session import SessionLocal
from app.models.models import Job, Dataset, DatasetItem, ModelWeight, LabelClass, AnnotationSet, Annotation
from app.core.config import settings
from app.services.inference import load_ultralytics_model, predict_bboxes
from app.services.annotations import get_or_create_default_annotation_set

def _update_job(db: Session, job: Job, status: str | None = None, progress: float | None = None, message: str | None = None):
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = float(progress)
    if message is not None:
        job.message = message
    job.updated_at = datetime.utcnow()
    db.add(job)
    db.commit()

@celery.task(name="auto_annotate_task")
def auto_annotate_task(job_id: int):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return

        _update_job(db, job, status="running", progress=0.0, message="starting")

        payload = job.payload or {}
        model_id = int(payload["model_id"])
        dataset_id = int(payload["dataset_id"])
        conf = float(payload.get("conf", 0.25))
        iou = float(payload.get("iou", 0.5))
        device = str(payload.get("device", "") or "")

        ds = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.project_id == job.project_id).first()
        if not ds:
            _update_job(db, job, status="failed", message="dataset not found")
            return

        mw = db.query(ModelWeight).filter(ModelWeight.id == model_id, ModelWeight.project_id == job.project_id).first()
        if not mw:
            _update_job(db, job, status="failed", message="model not found")
            return

        aset_id = payload.get("annotation_set_id")
        if aset_id:
            aset = db.query(AnnotationSet).filter(AnnotationSet.id == int(aset_id), AnnotationSet.project_id == job.project_id).first()
        else:
            aset = get_or_create_default_annotation_set(db, job.project_id)
        if not aset:
            _update_job(db, job, status="failed", message="annotation set not found")
            return

        classes = db.query(LabelClass).filter(LabelClass.project_id == job.project_id).all()
        name_to_class_id = {c.name.lower(): c.id for c in classes}

        class_mapping = {}
        try:
            class_mapping = (aset.params or {}).get("class_mapping") or {}
        except Exception:
            class_mapping = {}
        class_mapping = {str(k).lower(): str(v).lower() for k, v in class_mapping.items()}

        weights_path = Path(settings.storage_dir) / mw.rel_path
        if mw.framework != "ultralytics" or not weights_path.exists():
            _update_job(db, job, status="failed", message="auto annotate supports only ultralytics .pt in this MVP")
            return

        model = load_ultralytics_model(weights_path)

        items = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id).order_by(DatasetItem.id.asc()).all()
        total = len(items)
        if total == 0:
            _update_job(db, job, status="success", progress=1.0, message="no items")
            return

        # wipe existing annotations for this dataset+set (simple + predictable)
        db.query(Annotation).filter(
            Annotation.annotation_set_id == aset.id,
            Annotation.dataset_item_id.in_([it.id for it in items])
        ).delete(synchronize_session=False)
        db.commit()

        for idx, it in enumerate(items, start=1):
            img_path = Path(settings.storage_dir) / it.rel_path
            if not img_path.exists():
                continue
            preds = predict_bboxes(model, img_path, conf=conf, iou=iou, device=device)

            for p in preds:
                cls_idx = int(p["cls_idx"])
                try:
                    cls_name = str(model.names[cls_idx])
                except Exception:
                    cls_name = str(cls_idx)

                model_name = cls_name.lower()
                mapped = class_mapping.get(model_name, model_name)
                target_id = name_to_class_id.get(mapped)
                if not target_id:
                    continue

                x, y, w, h = p["xywh"]
                db.add(Annotation(
                    annotation_set_id=aset.id,
                    dataset_item_id=it.id,
                    class_id=target_id,
                    x=float(x), y=float(y), w=float(w), h=float(h),
                    confidence=float(p["conf"]) if p.get("conf") is not None else None,
                    approved=False,
                ))
            db.commit()
            _update_job(db, job, progress=idx / total, message=f"processed {idx}/{total}")

        _update_job(db, job, status="success", progress=1.0, message="done")
    except Exception as e:
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                _update_job(db, job, status="failed", message=str(e))
        except Exception:
            pass
    finally:
        db.close()
