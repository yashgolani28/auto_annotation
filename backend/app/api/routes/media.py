from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
from typing import Iterable, Optional, Tuple
from app.db.session import get_db
from app.models.models import DatasetItem
from app.core.config import settings

router = APIRouter()

_FIND_CACHE: dict[Tuple[Optional[int], str], str] = {}

def _is_windows_abs(p: str) -> bool:
    # "C:\..." or "C:/..."
    return len(p) >= 3 and p[1] == ":" and (p[2] == "\\" or p[2] == "/")

def _safe_storage_path(p: str) -> Path:
    """
    Resolve a DB-stored path safely under settings.storage_dir.
    Supports:
      - relative paths (preferred)
      - absolute paths ONLY if they still live under storage_dir

    DEV/LEGACY FIX:
      - if the DB contains an absolute path outside storage_dir but the file exists,
        allow it as a fallback (common when older rows stored C:\\... directly).
    Blocks path traversal for relative paths.
    """
    base = Path(settings.storage_dir).resolve()
    raw = (p or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="empty item path")

    norm = raw.replace("\\", "/")

    # Absolute path handling (Windows or POSIX)
    if norm.startswith("/") or _is_windows_abs(norm):
        cand = Path(raw).resolve()

        # preferred: absolute under storage_dir
        if cand == base or base in cand.parents:
            return cand

        if cand.exists() and cand.is_file():
            return cand

        raise HTTPException(status_code=400, detail="invalid item path")

    # Relative path handling
    rel = norm.lstrip("/")
    while rel.startswith("./"):
        rel = rel[2:]

    cand = (base / rel).resolve()
    if cand != base and base not in cand.parents:
        raise HTTPException(status_code=400, detail="invalid item path")
    return cand

def _candidate_relpaths(it: DatasetItem) -> Iterable[str]:
    """
    Try multiple possible columns/layouts. This fixes cases where DB stores only file_name
    but files are nested in dataset folders, or where a different column name is used.
    """
    # direct columns (depending on your model)
    for key in ("rel_path", "file_path", "path", "storage_path", "local_path", "uri"):
        v = getattr(it, key, None)
        if v:
            yield str(v)

    file_name = getattr(it, "file_name", None)
    dataset_id = getattr(it, "dataset_id", None)
    if file_name:
        # plain filename (legacy)
        yield str(file_name)

        # common layouts
        if dataset_id is not None:
            yield f"datasets/{dataset_id}/{file_name}"
            yield f"datasets/{dataset_id}/items/{file_name}"
            yield f"datasets/{dataset_id}/images/{file_name}"
            yield f"{dataset_id}/{file_name}"

def _find_in_storage(dataset_id: Optional[int], file_name: str) -> Optional[Path]:
    """
    Last-resort fallback: search storage_dir for the filename.
    Cached to avoid repeated rglob() cost.
    """
    if not file_name:
        return None
    key = (dataset_id, file_name)
    base = Path(settings.storage_dir).resolve()

    cached = _FIND_CACHE.get(key)
    if cached:
        p = Path(cached)
        if p.exists():
            return p
        _FIND_CACHE.pop(key, None)

    hits = [p for p in base.rglob(file_name) if p.is_file()]
    if not hits:
        return None

    # Prefer a hit that contains the dataset_id in its path if available
    chosen = hits[0]
    if dataset_id is not None:
        needle = f"/{dataset_id}/"
        for p in hits:
            if needle in p.as_posix():
                chosen = p
                break

    _FIND_CACHE[key] = str(chosen)
    return chosen

@router.get("/media/items/{item_id}")
def get_item_image(item_id: int, db: Session = Depends(get_db)):
    it = db.query(DatasetItem).filter(DatasetItem.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="item not found")
    # Try all candidate paths
    for rel in _candidate_relpaths(it):
        try:
            p = _safe_storage_path(rel)
        except HTTPException:
            continue
        if p.exists():
            return FileResponse(str(p))

    # Fallback search by filename within storage_dir
    dataset_id = getattr(it, "dataset_id", None)
    file_name = getattr(it, "file_name", None)
    if file_name:
        found = _find_in_storage(dataset_id, str(file_name))
        if found and found.exists():
            return FileResponse(str(found))

    raise HTTPException(status_code=404, detail="file missing")


@router.get("/media/logo")
def get_logo():
    # Company logo used in the frontend layout. Path provided by user.
    logo_path = Path(r"C:\ESSI\Projects\annotation_tool\essi_logo.png")
    if not logo_path.exists():
        raise HTTPException(status_code=404, detail="logo not found")
    return FileResponse(str(logo_path))
