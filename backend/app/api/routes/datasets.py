from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import shutil
import random

from app.db.session import get_db
from app.models.models import Project, Dataset, DatasetItem, User
from app.schemas.schemas import DatasetCreate, DatasetOut, DatasetItemOut
from app.services.storage import ensure_dirs, dataset_dir, sha256_file, image_size
from app.core.config import settings
from app.core.deps import get_current_user, require_project_access, require_project_role

router = APIRouter()

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
