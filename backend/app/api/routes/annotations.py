from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import DatasetItem, Annotation, AnnotationSet, LabelClass, Dataset
from app.schemas.schemas import AnnotationOut, AnnotationIn
from app.services.annotations import get_or_create_default_annotation_set

router = APIRouter()

@router.get("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def get_annotations(item_id: int, annotation_set_id: int | None = None, db: Session = Depends(get_db)):
    item = db.query(DatasetItem).filter(DatasetItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="item not found")

    if annotation_set_id is None:
        ds = db.query(Dataset).filter(Dataset.id == item.dataset_id).first()
        aset = get_or_create_default_annotation_set(db, ds.project_id)
        annotation_set_id = aset.id

    return db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id
    ).all()

@router.put("/items/{item_id}/annotations", response_model=list[AnnotationOut])
def replace_annotations(item_id: int, payload: list[AnnotationIn], annotation_set_id: int, db: Session = Depends(get_db)):
    item = db.query(DatasetItem).filter(DatasetItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="item not found")
    if not db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first():
        raise HTTPException(status_code=404, detail="annotation set not found")

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
            approved=a.approved
        ))
    db.commit()
    return db.query(Annotation).filter(
        Annotation.dataset_item_id == item_id,
        Annotation.annotation_set_id == annotation_set_id
    ).all()
