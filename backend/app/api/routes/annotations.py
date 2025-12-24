from __future__ import annotations
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import DatasetItem, Annotation, AnnotationSet, LabelClass, Dataset, AnnotationLock, AuditLog, User
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
    # project membership checked via project_id
    from app.core.deps import require_project_access
    require_project_access(ds.project_id, db, user)
    return it

@router.post("/items/{item_id}/lock")
def acquire_lock(item_id: int, annotation_set_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = _require_item_access(item_id, db, user)
    now = datetime.utcnow()

    # clean expired
    db.query(AnnotationLock).filter(AnnotationLock.expires_at < now).delete()
    db.commit()

    lock = db.query(AnnotationLock).filter(
        AnnotationLock.annotation_set_id == annotation_set_id,
        AnnotationLock.dataset_item_id == it.id
    ).first()

    if lock and lock.locked_by_user_id != user.id:
        raise HTTPException(status_code=409, detail="locked by another user")

    exp = now + timedelta(minutes=LOCK_MINUTES)
    if not lock:
        lock = AnnotationLock(
            annotation_set_id=annotation_set_id,
            dataset_item_id=it.id,
            locked_by_user_id=user.id,
            locked_at=now,
            expires_at=exp
        )
        db.add(lock)
    else:
        lock.expires_at = exp
        lock.locked_at = now
        db.add(lock)

    db.commit()
    return {"status": "ok", "expires_at": lock.expires_at.isoformat()}

@router.get("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def get_annotations(item_id: int, annotation_set_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _require_item_access(item_id, db, user)

    if annotation_set_id is None:
        ds = db.query(Dataset).filter(Dataset.id == item.dataset_id).first()
        aset = get_or_create_default_annotation_set(db, ds.project_id)
        annotation_set_id = aset.id

    return db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id
    ).all()

@router.put("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def replace_annotations(item_id: int, payload: list[AnnotationIn], annotation_set_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _require_item_access(item_id, db, user)

    aset = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
    if not aset:
        raise HTTPException(status_code=404, detail="annotation set not found")

    # lock enforcement: must hold lock to save (unless admin)
    if user.role != "admin":
        now = datetime.utcnow()
        lock = db.query(AnnotationLock).filter(
            AnnotationLock.annotation_set_id == annotation_set_id,
            AnnotationLock.dataset_item_id == item_id,
            AnnotationLock.locked_by_user_id == user.id,
            AnnotationLock.expires_at >= now
        ).first()
        if not lock:
            raise HTTPException(status_code=409, detail="no active lock (open image again to acquire lock)")

    db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id
    ).delete()

    for a in payload:
        if not db.query(LabelClass).filter(LabelClass.id == a.class_id).first():
            raise HTTPException(status_code=400, detail=f"class_id {a.class_id} invalid")
        db.add(Annotation(
            annotation_set_id=annotation_set_id,
            dataset_item_id=item_id,
            class_id=a.class_id,
            x=a.x, y=a.y, w=a.w, h=a.h,
            confidence=a.confidence,
            approved=a.approved,
            attributes=a.attributes or {},
            updated_at=datetime.utcnow()
        ))
    db.commit()

    # audit
    ds = db.query(Dataset).filter(Dataset.id == item.dataset_id).first()
    db.add(AuditLog(
        project_id=ds.project_id,
        user_id=user.id,
        action="annotation.replace",
        entity_type="dataset_item",
        entity_id=item_id,
        details={"annotation_set_id": annotation_set_id, "count": len(payload)},
    ))
    db.commit()

    return db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id
    ).all()
