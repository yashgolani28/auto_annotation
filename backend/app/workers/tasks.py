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
        # Support both model_id and model_weight_id for compatibility
        model_id = int(payload.get("model_id") or payload.get("model_weight_id", 0))
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

        # Get class mapping from payload params (frontend sends it there)
        class_mapping = {}
        try:
            params = payload.get("params", {})
            class_mapping = params.get("class_mapping", {})
        except Exception:
            pass
        class_mapping = {str(k).lower(): str(v).lower() for k, v in class_mapping.items()}

        # Create a new annotation set for this auto-run
        aset_name = f"auto_run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        aset = AnnotationSet(
            project_id=job.project_id,
            name=aset_name,
            source="auto",
            model_weight_id=mw.id,
            params={"class_mapping": class_mapping}
        )
        db.add(aset)
        db.commit()
        db.refresh(aset)

        classes = db.query(LabelClass).filter(LabelClass.project_id == job.project_id).all()
        if not classes:
            _update_job(db, job, status="failed", message="no label classes defined in project. please add classes first.")
            return
        
        name_to_class_id = {c.name.lower(): c.id for c in classes}

        weights_path = Path(settings.storage_dir) / mw.rel_path
        if mw.framework != "ultralytics" or not weights_path.exists():
            _update_job(db, job, status="failed", message="auto annotate supports only ultralytics .pt in this MVP")
            return

        try:
            model = load_ultralytics_model(weights_path)
        except Exception as e:
            _update_job(db, job, status="failed", message=f"failed to load model: {str(e)}")
            return

        items = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id).order_by(DatasetItem.id.asc()).all()
        total = len(items)
        if total == 0:
            _update_job(db, job, status="success", progress=1.0, message="no items")
            return

        # Get model class names for validation
        model_class_names = []
        try:
            if hasattr(model, "names"):
                if isinstance(model.names, dict):
                    model_class_names = [str(v).lower() for v in model.names.values()]
                elif isinstance(model.names, list):
                    model_class_names = [str(v).lower() for v in model.names]
        except Exception:
            pass

        # Warn if no mappings and model classes don't match project classes
        if not class_mapping and model_class_names:
            matched = [name for name in model_class_names if name in name_to_class_id]
            if not matched:
                project_class_names = [c.name.lower() for c in classes]
                _update_job(db, job, status="failed", 
                    message=f"no class mappings found. model classes: {', '.join(model_class_names[:5])}. project classes: {', '.join(project_class_names[:5])}. please map model classes to project classes in the UI.")
                return

        # wipe existing annotations for this dataset+set (simple + predictable)
        db.query(Annotation).filter(
            Annotation.annotation_set_id == aset.id,
            Annotation.dataset_item_id.in_([it.id for it in items])
        ).delete(synchronize_session=False)
        db.commit()

        annotations_created = 0
        skipped_no_match = 0
        
        for idx, it in enumerate(items, start=1):
            img_path = Path(settings.storage_dir) / it.rel_path
            if not img_path.exists():
                continue
            try:
                preds = predict_bboxes(model, img_path, conf=conf, iou=iou, device=device)
            except Exception as e:
                _update_job(db, job, progress=idx / total, message=f"error processing image {idx}/{total}: {str(e)}")
                continue

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
                    skipped_no_match += 1
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
                annotations_created += 1
            db.commit()
            _update_job(db, job, progress=idx / total, message=f"processed {idx}/{total} ({annotations_created} annotations created)")

        final_message = f"done. created {annotations_created} annotations"
        if skipped_no_match > 0:
            final_message += f", skipped {skipped_no_match} unmatched predictions"
        _update_job(db, job, status="success", progress=1.0, message=final_message)
    except Exception as e:
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                _update_job(db, job, status="failed", message=str(e))
        except Exception:
            pass
    finally:
        db.close()
