from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import ItemLock

router = APIRouter()

@router.post("/items/{item_id}/lock")
def acquire_or_refresh_lock(
    item_id: int,
    payload: dict | None = Body(default=None),
    annotation_set_id: int = Query(default=0),
    owner: str | None = Query(default=None),
    ttl_seconds: int = Query(default=300),
    db: Session = Depends(get_db),
):
    payload = payload or {}
    # allow both body and query param styles
    annotation_set_id = int(payload.get("annotation_set_id", annotation_set_id) or 0)
    owner = str(payload.get("owner", owner or "local"))
    ttl_seconds = int(payload.get("ttl_seconds", ttl_seconds) or 300)

    if annotation_set_id <= 0:
        raise HTTPException(status_code=400, detail="annotation_set_id required")

    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=ttl_seconds)

    lock = (
        db.query(ItemLock)
        .filter(ItemLock.dataset_item_id == item_id, ItemLock.annotation_set_id == annotation_set_id)
        .first()
    )

    if lock and lock.expires_at and lock.expires_at > now and lock.owner != owner:
        raise HTTPException(status_code=409, detail=f"locked by {lock.owner}")

    if not lock:
        lock = ItemLock(dataset_item_id=item_id, annotation_set_id=annotation_set_id, owner=owner, expires_at=expires)
        db.add(lock)
    else:
        lock.owner = owner
        lock.expires_at = expires

    db.commit()
    return {"ok": True, "owner": lock.owner, "expires_at": lock.expires_at.isoformat()}

@router.post("/items/{item_id}/unlock")
def release_lock(
    item_id: int,
    payload: dict | None = Body(default=None),
    annotation_set_id: int = Query(default=0),
    owner: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    payload = payload or {}
    annotation_set_id = int(payload.get("annotation_set_id", annotation_set_id) or 0)
    owner = payload.get("owner", owner)  # optional

    if annotation_set_id <= 0:
        raise HTTPException(status_code=400, detail="annotation_set_id required")

    lock = (
        db.query(ItemLock)
        .filter(ItemLock.dataset_item_id == item_id, ItemLock.annotation_set_id == annotation_set_id)
        .first()
    )

    if not lock:
        return {"ok": True}

    # If owner provided, enforce it (prevents deleting other user's lock)
    if owner and lock.owner != owner:
        raise HTTPException(status_code=409, detail=f"locked by {lock.owner}")

    db.delete(lock)
    db.commit()
    return {"ok": True}