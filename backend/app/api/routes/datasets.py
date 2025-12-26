from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import cast, Integer, func
from sqlalchemy import Integer as SAInteger
from pathlib import Path
import zipfile
import shutil
import random

from app.db.session import get_db
from app.models.models import Project, Dataset, DatasetItem, Annotation, AnnotationSet, User
from app.schemas.schemas import DatasetCreate, DatasetOut, DatasetItemOut, AnnotationOut
from app.services.storage import ensure_dirs, dataset_dir, sha256_file, image_size
from app.core.config import settings
from app.core.deps import get_current_user, require_project_access, require_project_role

router = APIRouter()

def _schema_validate(schema_cls, obj):
    """
    Compat helper: supports both Pydantic v2 (model_validate) and v1 (from_orm).
    Prevents 500s on /items-with-annotations across envs.
    """
    if hasattr(schema_cls, "model_validate"):
        return schema_cls.model_validate(obj)
    if hasattr(schema_cls, "from_orm"):
        return schema_cls.from_orm(obj)
    # last resort
    return schema_cls(**getattr(obj, "__dict__", obj))                                                                                     

def _schema_dump(schema_obj):
    """
    Compat helper: supports Pydantic v2 (model_dump) and v1 (dict).
    """
    if hasattr(schema_obj, "model_dump"):
        return schema_obj.model_dump()
    if hasattr(schema_obj, "dict"):
        return schema_obj.dict()
    return schema_obj

@router.post("/projects/{project_id}/datasets", response_model=DatasetOut)
def create_dataset(project_id: int, payload: DatasetCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    d = Dataset(project_id=project_id, name=payload.name)
    db.add(d)
    db.commit()
    db.refresh(d)
    ensure_dirs()
    dataset_dir(project_id, d.id).mkdir(parents=True, exist_ok=True)
    return d

@router.get("/projects/{project_id}/datasets", response_model=list[DatasetOut])
def list_datasets(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return db.query(Dataset).filter(Dataset.project_id == project_id).order_by(Dataset.created_at.desc()).all()


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="dataset not found")
    require_project_role(d.project_id, ["reviewer"], db, user)
    db.delete(d)
    db.commit()
    return {"status": "deleted"}

@router.post("/datasets/{dataset_id}/upload")
def upload_zip(dataset_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="dataset not found")
    require_project_access(d.project_id, db, user)

    ensure_dirs()
    out_dir = dataset_dir(d.project_id, d.id)
    out_dir.mkdir(parents=True, exist_ok=True)

    tmp_zip = Path(settings.storage_dir) / "tmp" / f"upload_{dataset_id}.zip"
    with tmp_zip.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    exts = {".jpg",".jpeg",".png",".bmp",".webp",".tif",".tiff"}
    added = 0
    with zipfile.ZipFile(tmp_zip, "r") as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if Path(name).suffix.lower() not in exts:
                continue
            dest = out_dir / name
            with z.open(info) as src, dest.open("wb") as dst:
                shutil.copyfileobj(src, dst)

            h = sha256_file(dest)
            w, h_img = image_size(dest)
            item = DatasetItem(
                dataset_id=d.id,
                rel_path=str(dest.relative_to(Path(settings.storage_dir))),
                file_name=name,
                sha256=h,
                width=w,
                height=h_img,
                split="train",
            )
            db.add(item)
            added += 1
    db.commit()
    try:
        tmp_zip.unlink()
    except Exception:
        pass
    return {"status": "ok", "added": added}

@router.get("/datasets/{dataset_id}/items", response_model=list[DatasetItemOut])
def list_items(dataset_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), split: str | None = None, limit: int = 200, offset: int = 0):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="dataset not found")
    require_project_access(d.project_id, db, user)

    q = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id)
    if split:
        q = q.filter(DatasetItem.split == split)
    return q.order_by(DatasetItem.id.asc()).offset(offset).limit(min(limit, 500)).all()

@router.post("/datasets/{dataset_id}/split/random")
def random_split(dataset_id: int, payload: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="dataset not found")
    require_project_role(d.project_id, ["reviewer"], db, user)

    train = float(payload.get("train", 0.8))
    val = float(payload.get("val", 0.1))
    test = float(payload.get("test", 0.1))
    seed = int(payload.get("seed", 42))
    if abs((train + val + test) - 1.0) > 1e-6:
        raise HTTPException(status_code=400, detail="train+val+test must sum to 1.0")

    items = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset_id).all()
    random.Random(seed).shuffle(items)

    n = len(items)
    n_train = int(n * train)
    n_val = int(n * val)
    for i, it in enumerate(items):
        if i < n_train:
            it.split = "train"
        elif i < n_train + n_val:
            it.split = "val"
        else:
            it.split = "test"
        db.add(it)
    db.commit()
    return {"status": "ok", "count": n}

@router.get("/datasets/{dataset_id}/items-with-annotations")
def get_items_with_annotations(
    dataset_id: int,
    annotation_set_id: int | None = Query(default=None),
    aset: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = 500,
    offset: int = 0
):
    """Get dataset items that have annotations in a specific annotation set"""
    final_aset_id = annotation_set_id or aset
    if final_aset_id is None:
        raise HTTPException(status_code=422, detail="annotation_set_id (or aset) is required")
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="dataset not found")
    require_project_access(d.project_id, db, user)

    aset_obj = db.query(AnnotationSet).filter(
        AnnotationSet.id == final_aset_id,
        AnnotationSet.project_id == d.project_id
    ).first()
    if not aset_obj:
        raise HTTPException(status_code=404, detail="annotation set not found")

    # ---- SAFEST cross-DB implementation ----
    # 1) fetch distinct dataset_item_id values without DB casts (prevents Postgres cast failures)
    raw_ids = [
        r[0]
        for r in db.query(Annotation.dataset_item_id)
        .filter(Annotation.annotation_set_id == final_aset_id)
        .filter(Annotation.dataset_item_id.isnot(None))
        .distinct()
        .all()
    ]

    # 2) parse only numeric ids in Python
    all_item_ids: list[int] = []
    for v in raw_ids:
        try:
            all_item_ids.append(int(v))
        except Exception:
            continue
    all_item_ids = sorted(set(all_item_ids))
    if not all_item_ids:
        return []

    # 3) page items
    items_with_anns = (
        db.query(DatasetItem)
        .filter(DatasetItem.dataset_id == dataset_id)
        .filter(DatasetItem.id.in_(all_item_ids))
        .order_by(DatasetItem.id.asc())
        .offset(offset)
        .limit(min(limit, 500))
        .all()
    )
    if not items_with_anns:
        return []

    page_ids = [it.id for it in items_with_anns]
    page_ids_set = set(page_ids)

    # 4) fetch annotations for just these page items, using correct type based on column
    col = Annotation.__table__.c.dataset_item_id
    is_int_col = False
    try:
        is_int_col = (getattr(col.type, "python_type", None) == int) or isinstance(col.type, SAInteger)
    except Exception:
        is_int_col = False

    if is_int_col:
        anns_all = (
            db.query(Annotation)
            .filter(Annotation.annotation_set_id == final_aset_id)
            .filter(Annotation.dataset_item_id.in_(page_ids))
            .all()
        )
    else:
        page_ids_str = [str(i) for i in page_ids]
        anns_all = (
            db.query(Annotation)
            .filter(Annotation.annotation_set_id == final_aset_id)
            .filter(Annotation.dataset_item_id.in_(page_ids_str))
            .all()
        )

    ann_by_item: dict[int, list[Annotation]] = {}
    for a in anns_all:
        try:
            k = int(a.dataset_item_id)
        except Exception:
            continue
        if k in page_ids_set:
            ann_by_item.setdefault(k, []).append(a)

    # 5) return plain dicts (no schema dependency -> no pydantic version crashes)
    out = []
    for item in items_with_anns:
        anns = ann_by_item.get(item.id, [])
        out.append(
            {
                "item": {
                    "id": item.id,
                    "file_name": item.file_name,
                    "width": item.width,
                    "height": item.height,
                    "split": item.split,
                },
                "annotations": [
                    {
                        "id": a.id,
                        "class_id": a.class_id,
                        "x": a.x,
                        "y": a.y,
                        "w": a.w,
                        "h": a.h,
                        "confidence": a.confidence,
                        "approved": a.approved,
                    }
                    for a in anns
                ],
                "annotation_count": len(anns),
            }
        )

    return out

@router.get("/debug/annotation-set/{aset_id}")
def debug_annotation_set(
    aset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    aset = db.query(AnnotationSet).filter(AnnotationSet.id == aset_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    require_project_access(aset.project_id, db, user)

    total = db.query(func.count(Annotation.id)).filter(Annotation.annotation_set_id == aset_id).scalar() or 0
    non_null = db.query(func.count(Annotation.id)).filter(
        Annotation.annotation_set_id == aset_id,
        Annotation.dataset_item_id.isnot(None),
    ).scalar() or 0

    sample_dataset_item_ids = [
        r[0] for r in db.query(Annotation.dataset_item_id)
        .filter(Annotation.annotation_set_id == aset_id)
        .limit(20)
        .all()
    ]

    # try casting to int to detect "filenames/paths" becoming 0
    sample_cast_int = [
        r[0] for r in db.query(cast(Annotation.dataset_item_id, Integer))
        .filter(Annotation.annotation_set_id == aset_id, Annotation.dataset_item_id.isnot(None))
        .limit(20)
        .all()
    ]

    return {
        "aset_id": aset_id,
        "project_id": aset.project_id,
        "total_annotations": int(total),
        "non_null_dataset_item_id": int(non_null),
        "sample_dataset_item_id_raw": sample_dataset_item_ids,
        "sample_dataset_item_id_cast_int": sample_cast_int,
    }
