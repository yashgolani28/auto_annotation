from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import shutil
import json

from app.db.session import get_db
from app.models.models import Dataset, DatasetItem, AnnotationSet, Annotation, LabelClass, AuditLog, User
from app.core.config import settings
from app.core.deps import get_current_user, require_project_role, require_project_access

router = APIRouter()

def _classes_map(db: Session, project_id: int):
    classes = db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()
    by_index = {i: c.id for i, c in enumerate(classes)}
    by_name = {c.name.lower(): c.id for c in classes}
    return classes, by_index, by_name

@router.post("/projects/{project_id}/imports/yolo")
def import_yolo(project_id: int, dataset_id: int, annotation_set_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_role(project_id, ["reviewer"], db, user)

    ds = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.project_id == project_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="dataset not found")
    aset = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id, AnnotationSet.project_id == project_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    ensure_tmp = Path(settings.storage_dir) / "tmp"
    ensure_tmp.mkdir(parents=True, exist_ok=True)
    tmp_zip = ensure_tmp / f"import_yolo_{project_id}_{dataset_id}.zip"
    with tmp_zip.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    items = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id).all()
    item_by_stem = {Path(it.file_name).stem: it for it in items}

    _, by_index, _ = _classes_map(db, project_id)

    imported = 0
    db.query(Annotation).filter(Annotation.annotation_set_id == annotation_set_id, Annotation.dataset_item_id.in_([it.id for it in items])).delete(synchronize_session=False)
    db.commit()

    with zipfile.ZipFile(tmp_zip, "r") as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            if Path(info.filename).suffix.lower() != ".txt":
                continue
            stem = Path(info.filename).stem
            it = item_by_stem.get(stem)
            if not it:
                continue
            with z.open(info) as f:
                lines = f.read().decode("utf-8", errors="ignore").splitlines()
            for line in lines:
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                cls_i = int(float(parts[0]))
                if cls_i not in by_index:
                    continue
                x_c, y_c, w_n, h_n = map(float, parts[1:5])

                # to xywh px
                w = w_n * it.width
                h = h_n * it.height
                x = (x_c * it.width) - (w / 2)
                y = (y_c * it.height) - (h / 2)

                db.add(Annotation(
                    annotation_set_id=annotation_set_id,
                    dataset_item_id=it.id,
                    class_id=by_index[cls_i],
                    x=float(x), y=float(y), w=float(w), h=float(h),
                    confidence=None,
                    approved=False,
                ))
                imported += 1
    db.commit()

    db.add(AuditLog(project_id=project_id, user_id=user.id, action="import.yolo", entity_type="annotation_set", entity_id=annotation_set_id, details={"dataset_id": dataset_id, "boxes": imported}))
    db.commit()

    try:
        tmp_zip.unlink()
    except Exception:
        pass

    return {"status": "ok", "boxes": imported}

@router.post("/projects/{project_id}/imports/coco")
def import_coco(project_id: int, dataset_id: int, annotation_set_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_role(project_id, ["reviewer"], db, user)

    ds = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.project_id == project_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="dataset not found")
    aset = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id, AnnotationSet.project_id == project_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    content = json.loads((file.file.read() or b"{}").decode("utf-8", errors="ignore"))

    items = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id).all()
    item_by_filename = {it.file_name: it for it in items}
    _, _, by_name = _classes_map(db, project_id)

    # map coco category id -> project class id by category name
    cat_id_to_class_id = {}
    for c in content.get("categories", []):
        name = str(c.get("name", "")).lower()
        if name in by_name:
            cat_id_to_class_id[int(c["id"])] = by_name[name]

    # image_id -> DatasetItem
    img_id_to_item = {}
    for img in content.get("images", []):
        fn = Path(str(img.get("file_name", ""))).name
        it = item_by_filename.get(fn)
        if it:
            img_id_to_item[int(img["id"])] = it

    # wipe existing for dataset+aset
    db.query(Annotation).filter(Annotation.annotation_set_id == annotation_set_id, Annotation.dataset_item_id.in_([it.id for it in items])).delete(synchronize_session=False)
    db.commit()

    imported = 0
    for ann in content.get("annotations", []):
        image_id = int(ann.get("image_id"))
        cat_id = int(ann.get("category_id"))
        it = img_id_to_item.get(image_id)
        cls_id = cat_id_to_class_id.get(cat_id)
        if not it or not cls_id:
            continue
        bbox = ann.get("bbox") or []
        if len(bbox) != 4:
            continue
        x, y, w, h = map(float, bbox)
        db.add(Annotation(annotation_set_id=annotation_set_id, dataset_item_id=it.id, class_id=cls_id, x=x, y=y, w=w, h=h, confidence=None, approved=False))
        imported += 1

    db.commit()
    db.add(AuditLog(project_id=project_id, user_id=user.id, action="import.coco", entity_type="annotation_set", entity_id=annotation_set_id, details={"dataset_id": dataset_id, "boxes": imported}))
    db.commit()
    return {"status": "ok", "boxes": imported}
