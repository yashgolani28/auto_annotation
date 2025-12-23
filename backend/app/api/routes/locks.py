from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime

from app.db.session import get_db
from app.models.models import AnnotationLock, User
from app.core.deps import get_current_user

router = APIRouter()

@router.get("/locks/active")
def active_locks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    locks = db.query(AnnotationLock).filter(AnnotationLock.expires_at >= now).order_by(AnnotationLock.locked_at.desc()).limit(200).all()
    return [
        {"id": l.id, "annotation_set_id": l.annotation_set_id, "dataset_item_id": l.dataset_item_id, "locked_by_user_id": l.locked_by_user_id, "expires_at": l.expires_at.isoformat()}
        for l in locks
    ]
