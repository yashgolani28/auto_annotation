from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Project, LabelClass, AnnotationSet
from app.schemas.schemas import ProjectCreate, ProjectOut, ClassIn, ClassOut, AnnotationSetOut
from app.services.annotations import get_or_create_default_annotation_set

router = APIRouter()

@router.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    if db.query(Project).filter(Project.name == payload.name).first():
        raise HTTPException(status_code=409, detail="project name already exists")
    p = Project(name=payload.name, task_type=payload.task_type)
    db.add(p)
    db.commit()
    db.refresh(p)
    get_or_create_default_annotation_set(db, p.id)
    return p

@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()

@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return p

@router.post("/projects/{project_id}/classes", response_model=list[ClassOut])
def set_classes(project_id: int, classes: list[ClassIn], db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    db.query(LabelClass).filter(LabelClass.project_id == project_id).delete()
    for i, c in enumerate(classes):
        db.add(LabelClass(project_id=project_id, name=c.name, color=c.color, order_index=i))
    db.commit()
    return db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()

@router.get("/projects/{project_id}/classes", response_model=list[ClassOut])
def get_classes(project_id: int, db: Session = Depends(get_db)):
    return db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()

@router.get("/projects/{project_id}/annotation-sets", response_model=list[AnnotationSetOut])
def list_annotation_sets(project_id: int, db: Session = Depends(get_db)):
    return db.query(AnnotationSet).filter(AnnotationSet.project_id == project_id).order_by(AnnotationSet.id.asc()).all()
