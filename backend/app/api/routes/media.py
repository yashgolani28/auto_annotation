from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
from app.db.session import get_db
from app.models.models import DatasetItem
from app.core.config import settings

router = APIRouter()

def _safe_storage_path(rel_path: str) -> Path:
    """Join rel_path under settings.storage_dir safely.
    - normalizes windows separators stored in DB
    - strips leading slashes
    - blocks path traversal
    """
    base = Path(settings.storage_dir).resolve()
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    # Remove any leading './' segments
    while rel.startswith("./"):
        rel = rel[2:]

    candidate = (base / rel).resolve()
    # Ensure candidate stays under base
    if candidate != base and base not in candidate.parents:
        raise HTTPException(status_code=400, detail="invalid item path")

    return candidate

@router.get("/media/items/{item_id}")
def get_item_image(item_id: int, db: Session = Depends(get_db)):
    it = db.query(DatasetItem).filter(DatasetItem.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="item not found")
    rel_path = getattr(it, "rel_path", None) or getattr(it, "file_name", None)
    if not rel_path:
        raise HTTPException(status_code=404, detail="item has no file path")
    p = _safe_storage_path(str(rel_path))
    if not p.exists():
        raise HTTPException(status_code=404, detail="file missing")
    return FileResponse(str(p))


@router.get("/media/logo")
def get_logo():
    # Company logo used in the frontend layout. Path provided by user.
    logo_path = Path(r"C:\ESSI\Projects\annotation_tool\essi_logo.png")
    if not logo_path.exists():
        raise HTTPException(status_code=404, detail="logo not found")
    return FileResponse(str(logo_path))
