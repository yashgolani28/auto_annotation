from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import ItemLock

router = APIRouter()

@router.post("/items/{item_id}/lock")
def acquire_or_refresh_lock(item_id: int, payload: dict, db: Session = Depends(get_db)):
    annotation_set_id = int(payload.get("annotation_set_id", 0))
    owner = payload.get("owner", "local")  # frontend can send user email/id
    ttl_seconds = int(payload.get("ttl_seconds", 60))

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
