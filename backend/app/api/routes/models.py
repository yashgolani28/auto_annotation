from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pathlib import Path
import shutil

from app.db.session import get_db
from app.models.models import Project, ModelWeight, User
from app.schemas.schemas import ModelOut
from app.services.storage import ensure_dirs, models_dir
from app.services.inference import load_ultralytics_model, get_model_class_names
from app.core.config import settings
from app.core.deps import get_current_user, require_project_access, require_project_role

router = APIRouter()

@router.post("/projects/{project_id}/models", response_model=ModelOut)
def upload_model(project_id: int, name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_role(project_id, ["reviewer"], db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    ensure_dirs()
    mdir = models_dir(project_id)
    mdir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".pt", ".onnx"}:
        raise HTTPException(status_code=400, detail="only .pt or .onnx supported")
    dest = mdir / f"{name}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    framework = "ultralytics" if suffix == ".pt" else "onnx"
    class_names = {}
    meta = {}
    if framework == "ultralytics":
        try:
            model = load_ultralytics_model(dest)
            class_names = get_model_class_names(model)
            meta = {"task": getattr(model, "task", None)}
        except Exception as e:
            meta = {"warning": f"could not read class names: {e}"}

    mw = ModelWeight(
        project_id=project_id,
        name=name,
        framework=framework,
        rel_path=str(dest.relative_to(Path(settings.storage_dir))),
        class_names=class_names,
        meta=meta,
    )
    db.add(mw)
    db.commit()
    db.refresh(mw)
    return mw

@router.get("/projects/{project_id}/models", response_model=list[ModelOut])
def list_models(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return db.query(ModelWeight).filter(ModelWeight.project_id == project_id).order_by(ModelWeight.uploaded_at.desc()).all()
