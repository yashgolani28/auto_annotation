from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.models import AnnotationSet

def get_or_create_default_annotation_set(db: Session, project_id: int) -> AnnotationSet:
    aset = db.query(AnnotationSet).filter(AnnotationSet.project_id == project_id).order_by(AnnotationSet.id.asc()).first()
    if aset:
        return aset
    aset = AnnotationSet(project_id=project_id, name="default", source="manual")
    db.add(aset)
    db.commit()
    db.refresh(aset)
    return aset
