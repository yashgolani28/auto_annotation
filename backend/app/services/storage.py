from __future__ import annotations
import hashlib
from pathlib import Path
from typing import Tuple
from PIL import Image
from app.core.config import settings

def ensure_dirs():
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    for sub in ["projects", "exports", "tmp"]:
        (Path(settings.storage_dir) / sub).mkdir(parents=True, exist_ok=True)

def project_dir(project_id: int) -> Path:
    return Path(settings.storage_dir) / "projects" / str(project_id)

def dataset_dir(project_id: int, dataset_id: int) -> Path:
    return project_dir(project_id) / "datasets" / str(dataset_id) / "images"

def models_dir(project_id: int) -> Path:
    return project_dir(project_id) / "models"

def exports_dir() -> Path:
    return Path(settings.storage_dir) / "exports"

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def image_size(path: Path) -> Tuple[int, int]:
    with Image.open(path) as im:
        w, h = im.size
    return int(w), int(h)
