from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Project, LabelClass, AnnotationSet, ProjectMember, User
from app.schemas.schemas import ProjectCreate, ProjectOut, ClassIn, ClassOut, AnnotationSetOut
from app.services.annotations import get_or_create_default_annotation_set
from app.core.deps import get_current_user, require_project_access, require_project_role

router = APIRouter()

@router.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # allow any logged-in user to create a project; creator becomes admin-ish member
    if db.query(Project).filter(Project.name == payload.name).first():
        raise HTTPException(status_code=409, detail="project name already exists")

    p = Project(name=payload.name, task_type=payload.task_type)
    db.add(p)
    db.commit()
    db.refresh(p)

    # creator membership
    db.add(ProjectMember(project_id=p.id, user_id=user.id, role="reviewer"))
    db.commit()

    get_or_create_default_annotation_set(db, p.id)
    return p

@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "admin":
        return db.query(Project).order_by(Project.created_at.desc()).all()
    # only projects where user is member
    return (
        db.query(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .filter(ProjectMember.user_id == user.id)
        .order_by(Project.created_at.desc())
        .all()
    )

@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return p

@router.post("/projects/{project_id}/classes", response_model=list[ClassOut])
def set_classes(project_id: int, classes: list[ClassIn], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_role(project_id, ["reviewer"], db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    db.query(LabelClass).filter(LabelClass.project_id == project_id).delete()
    for i, c in enumerate(classes):
        db.add(LabelClass(project_id=project_id, name=c.name, color=c.color, order_index=i))
    db.commit()
    return db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()

@router.get("/projects/{project_id}/classes", response_model=list[ClassOut])
def get_classes(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return db.query(LabelClass).filter(LabelClass.project_id == project_id).order_by(LabelClass.order_index.asc()).all()

@router.get("/projects/{project_id}/annotation-sets", response_model=list[AnnotationSetOut])
def list_annotation_sets(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return db.query(AnnotationSet).filter(AnnotationSet.project_id == project_id).order_by(AnnotationSet.id.asc()).all()

@router.get("/projects/{project_id}/members")
def list_members(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    rows = (
        db.query(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .filter(ProjectMember.project_id == project_id)
        .all()
    )
    return [
        {"member_id": m.id, "user_id": u.id, "email": u.email, "name": u.name, "role": m.role}
        for (m, u) in rows
    ]

@router.post("/projects/{project_id}/members")
def add_member(project_id: int, payload: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_role(project_id, ["reviewer"], db, user)
    email = (payload.get("email") or "").strip().lower()
    role = payload.get("role") or "annotator"
    target = db.query(User).filter(User.email == email).first()
    if not target:
        raise HTTPException(status_code=404, detail="user not found")
    if db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == target.id).first():
        raise HTTPException(status_code=409, detail="already a member")
    db.add(ProjectMember(project_id=project_id, user_id=target.id, role=role))
    db.commit()
    return {"status": "ok"}
