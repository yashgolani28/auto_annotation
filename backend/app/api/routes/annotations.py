from __future__ import annotations

from datetime import datetime, timedelta
import mimetypes
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import cast, String
from sqlalchemy import Integer as SAInteger
from pathlib import Path

from app.db.session import get_db
from app.models.models import (
    DatasetItem,
    Annotation,
    AnnotationSet,
    LabelClass,
    Dataset,
    AnnotationLock,
    AuditLog,
    User,
)
from app.schemas.schemas import AnnotationOut, AnnotationIn
from app.services.annotations import get_or_create_default_annotation_set
from app.core.deps import get_current_user

router = APIRouter()

LOCK_MINUTES = 10


def _require_item_access(item_id: int, db: Session, user: User) -> DatasetItem:
    it = db.query(DatasetItem).filter(DatasetItem.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="item not found")
    ds = db.query(Dataset).filter(Dataset.id == it.dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="dataset not found")
    from app.core.deps import require_project_access

    require_project_access(ds.project_id, db, user)
    return it


def _pick_aset_id(payload: dict, q_aset: int | None) -> int:
    try:
        v = payload.get("annotation_set_id") or q_aset
        return int(v or 0)
    except Exception:
        return 0


def _pick_ttl_seconds(payload: dict) -> int:
    # frontend sends ttl_seconds; default to LOCK_MINUTES if not present
    try:
        ttl = int(payload.get("ttl_seconds") or (LOCK_MINUTES * 60))
    except Exception:
        ttl = LOCK_MINUTES * 60
    # clamp to sane range
    return max(30, min(3600, ttl))


@router.post("/items/{item_id}/lock")
def acquire_lock(
    item_id: int,
    payload: dict = Body(default={}),
    annotation_set_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Accepts BOTH:
      - JSON body: { "annotation_set_id": 1, "ttl_seconds": 300, ... }
      - or query:  /items/{id}/lock?annotation_set_id=1
    """
    it = _require_item_access(item_id, db, user)

    aset_id = _pick_aset_id(payload or {}, annotation_set_id)
    if aset_id <= 0:
        raise HTTPException(status_code=400, detail="annotation_set_id required")

    now = datetime.utcnow()

    # clean expired locks
    db.query(AnnotationLock).filter(AnnotationLock.expires_at < now).delete(synchronize_session=False)
    db.commit()

    lock = (
        db.query(AnnotationLock)
        .filter(
            AnnotationLock.annotation_set_id == aset_id,
            AnnotationLock.dataset_item_id == it.id,
        )
        .first()
    )

    if lock and lock.locked_by_user_id != user.id:
        raise HTTPException(status_code=409, detail="locked by another user")

    ttl_seconds = _pick_ttl_seconds(payload or {})
    exp = now + timedelta(seconds=ttl_seconds)

    if not lock:
        lock = AnnotationLock(
            annotation_set_id=aset_id,
            dataset_item_id=it.id,
            locked_by_user_id=user.id,
            locked_at=now,
            expires_at=exp,
        )
        db.add(lock)
    else:
        lock.expires_at = exp
        lock.locked_at = now
        db.add(lock)

    db.commit()
    return {"ok": True, "expires_at": lock.expires_at.isoformat()}


@router.post("/items/{item_id}/unlock")
def release_lock(
    item_id: int,
    payload: dict = Body(default={}),
    annotation_set_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Optional but nice: frontend calls /unlock on cleanup.
    """
    _require_item_access(item_id, db, user)

    aset_id = _pick_aset_id(payload or {}, annotation_set_id)
    if aset_id <= 0:
        raise HTTPException(status_code=400, detail="annotation_set_id required")

    db.query(AnnotationLock).filter(
        AnnotationLock.annotation_set_id == aset_id,
        AnnotationLock.dataset_item_id == item_id,
        AnnotationLock.locked_by_user_id == user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.get("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def get_annotations(
    item_id: int,
    annotation_set_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = _require_item_access(item_id, db, user)

    if annotation_set_id is None:
        ds = db.query(Dataset).filter(Dataset.id == item.dataset_id).first()
        aset = get_or_create_default_annotation_set(db, ds.project_id)
        annotation_set_id = aset.id

    return (
        db.query(Annotation)
        .filter(
            Annotation.dataset_item_id == item_id,
            Annotation.annotation_set_id == annotation_set_id,
        )
        .all()
    )


@router.put("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def replace_annotations(
    item_id: int,
    payload: list[AnnotationIn],
    annotation_set_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = _require_item_access(item_id, db, user)

    aset = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    # lock enforcement: must hold lock to save (unless admin)
    if user.role != "admin":
        now = datetime.utcnow()
        lock = (
            db.query(AnnotationLock)
            .filter(
                AnnotationLock.annotation_set_id == annotation_set_id,
                AnnotationLock.dataset_item_id == item_id,
                AnnotationLock.locked_by_user_id == user.id,
                AnnotationLock.expires_at >= now,
            )
            .first()
        )
        if not lock:
            raise HTTPException(
                status_code=409,
                detail="no active lock (open image again to acquire lock)",
            )

    db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id,
    ).delete(synchronize_session=False)

    for a in payload:
        if not db.query(LabelClass).filter(LabelClass.id == a.class_id).first():
            raise HTTPException(status_code=400, detail=f"class_id {a.class_id} invalid")
        db.add(
            Annotation(
                annotation_set_id=annotation_set_id,
                dataset_item_id=item_id,
                class_id=a.class_id,
                x=a.x,
                y=a.y,
                w=a.w,
                h=a.h,
                confidence=a.confidence,
                approved=a.approved,
                attributes=a.attributes or {},
                updated_at=datetime.utcnow(),
            )
        )
    db.commit()

    # audit
    ds = db.query(Dataset).filter(Dataset.id == item.dataset_id).first()
    db.add(
        AuditLog(
            project_id=ds.project_id,
            user_id=user.id,
            action="annotation.replace",
            entity_type="dataset_item",
            entity_id=item_id,
            details={"annotation_set_id": annotation_set_id, "count": len(payload)},
        )
    )
    db.commit()

    return (
        db.query(Annotation)
        .filter(
            Annotation.dataset_item_id == item_id,
            Annotation.annotation_set_id == annotation_set_id,
        )
        .all()
    )


# --------------------------------------------------------------------
# Bulk approval endpoints
# --------------------------------------------------------------------

def _ann_item_id_is_int_col() -> bool:
    col = Annotation.__table__.c.dataset_item_id
    try:
        return (getattr(col.type, "python_type", None) == int) or isinstance(col.type, SAInteger)
    except Exception:
        return False


@router.post("/projects/{project_id}/annotation-sets/{annotation_set_id}/approve-auto")
def approve_all_auto_annotations_for_project(
    project_id: int,
    annotation_set_id: int,
    payload: dict = Body(default={}),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Bulk-approve ALL *auto* annotations for a project within a given annotation set.

    Payload (optional):
      - only_auto: bool (default True)  -> only approve annotations with confidence != NULL
      - dataset_id: int (optional)      -> restrict to a single dataset
      - split: str (optional)           -> restrict to train/val/test
    """
    from app.core.deps import require_project_access, require_project_role

    require_project_access(project_id, db, user)
    require_project_role(project_id, ["reviewer", "admin"], db, user)

    aset = (
        db.query(AnnotationSet)
        .filter(AnnotationSet.id == annotation_set_id, AnnotationSet.project_id == project_id)
        .first()
    )
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    only_auto = bool((payload or {}).get("only_auto", True))
    dataset_id = (payload or {}).get("dataset_id", None)
    split = (payload or {}).get("split", None)

    # dataset items within this project (optionally filtered)
    item_q = (
        db.query(DatasetItem.id)
        .join(Dataset, Dataset.id == DatasetItem.dataset_id)
        .filter(Dataset.project_id == project_id)
    )
    if dataset_id:
        try:
            item_q = item_q.filter(DatasetItem.dataset_id == int(dataset_id))
        except Exception:
            pass
    if split:
        item_q = item_q.filter(DatasetItem.split == str(split))

    is_int_col = _ann_item_id_is_int_col()
    if is_int_col:
        item_ids_subq = item_q.subquery()
    else:
        # Cast DatasetItem.id (int) -> string is safe (unlike casting Annotation.dataset_item_id -> int)
        item_ids_subq = (
            db.query(cast(DatasetItem.id, String))
            .select_from(DatasetItem)
            .join(Dataset, Dataset.id == DatasetItem.dataset_id)
            .filter(Dataset.project_id == project_id)
        )
        if dataset_id:
            try:
                item_ids_subq = item_ids_subq.filter(DatasetItem.dataset_id == int(dataset_id))
            except Exception:
                pass
        if split:
            item_ids_subq = item_ids_subq.filter(DatasetItem.split == str(split))
        item_ids_subq = item_ids_subq.subquery()

    q = db.query(Annotation).filter(
        Annotation.annotation_set_id == annotation_set_id,
        Annotation.approved.is_(False),
    )
    if only_auto:
        q = q.filter(Annotation.confidence.isnot(None))

    # restrict to this project's dataset items
    q = q.filter(Annotation.dataset_item_id.in_(item_ids_subq))

    updated = q.update(
        {Annotation.approved: True, Annotation.updated_at: datetime.utcnow()},
        synchronize_session=False,
    )
    db.commit()

    # audit
    db.add(
        AuditLog(
            project_id=project_id,
            user_id=user.id,
            action="annotation.approve_all_auto",
            entity_type="annotation_set",
            entity_id=annotation_set_id,
            details={
                "only_auto": only_auto,
                "dataset_id": dataset_id,
                "split": split,
                "updated": int(updated),
            },
        )
    )
    db.commit()

    return {"updated": int(updated)}


@router.post("/projects/{project_id}/annotation-sets/{annotation_set_id}/items/{item_id}/approve")
def approve_annotations_for_item(
    project_id: int,
    annotation_set_id: int,
    item_id: int,
    payload: dict = Body(default={}),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Approve annotations for a single image (dataset item) within an annotation set.

    Payload (optional):
      - only_auto: bool (default True)
    """
    from app.core.deps import require_project_access, require_project_role

    require_project_access(project_id, db, user)
    require_project_role(project_id, ["reviewer", "admin"], db, user)

    aset = (
        db.query(AnnotationSet)
        .filter(AnnotationSet.id == annotation_set_id, AnnotationSet.project_id == project_id)
        .first()
    )
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    it = _require_item_access(item_id, db, user)
    ds = db.query(Dataset).filter(Dataset.id == it.dataset_id).first()
    if not ds or ds.project_id != project_id:
        raise HTTPException(status_code=404, detail="item not found in this project")

    only_auto = bool((payload or {}).get("only_auto", True))

    is_int_col = _ann_item_id_is_int_col()
    item_key = item_id if is_int_col else str(item_id)

    q = db.query(Annotation).filter(
        Annotation.annotation_set_id == annotation_set_id,
        Annotation.dataset_item_id == item_key,
        Annotation.approved.is_(False),
    )
    if only_auto:
        q = q.filter(Annotation.confidence.isnot(None))

    updated = q.update(
        {Annotation.approved: True, Annotation.updated_at: datetime.utcnow()},
        synchronize_session=False,
    )
    db.commit()

    db.add(
        AuditLog(
            project_id=project_id,
            user_id=user.id,
            action="annotation.approve_item",
            entity_type="dataset_item",
            entity_id=item_id,
            details={"annotation_set_id": annotation_set_id, "only_auto": only_auto, "updated": int(updated)},
        )
    )
    db.commit()

    return {"updated": int(updated)}


# --------------------------------------------------------------------
# Image file endpoint
# --------------------------------------------------------------------
@router.get("/items/{item_id}/file")
def get_item_file(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    it = _require_item_access(item_id, db, user)

    from app.api.routes.media import _candidate_relpaths, _safe_storage_path, _find_in_storage
    from app.core.config import settings

    tried: list[str] = []

    for rel in _candidate_relpaths(it):
        tried.append(rel)
        try:
            p = _safe_storage_path(rel)
        except HTTPException:
            continue
        if p.exists() and p.is_file():
            mt = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            return FileResponse(str(p), media_type=mt, filename=Path(p).name)

    dataset_id = getattr(it, "dataset_id", None)
    file_name = getattr(it, "file_name", None)
    if file_name:
        found = _find_in_storage(dataset_id, str(file_name))
        if found and found.exists():
            mt = mimetypes.guess_type(str(found))[0] or "application/octet-stream"
            return FileResponse(str(found), media_type=mt, filename=Path(found).name)

    raise HTTPException(
        status_code=404,
        detail={
            "error": "file missing",
            "item_id": item_id,
            "dataset_id": getattr(it, "dataset_id", None),
            "file_name": getattr(it, "file_name", None),
            "storage_dir": getattr(settings, "storage_dir", None),
            "tried_paths": tried[:20],
        },
    )
