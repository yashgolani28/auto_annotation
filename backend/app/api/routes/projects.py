from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from app.db.session import get_db
from app.models.models import (
    Project,
    LabelClass,
    AnnotationSet,
    ProjectMember,
    User,
    Dataset,
    DatasetItem,
    Annotation,
    Job,
    ModelWeight,
    ItemLock,
)
from app.schemas.schemas import ProjectCreate, ProjectOut, ClassIn, ClassOut, AnnotationSetOut
from app.services.annotations import get_or_create_default_annotation_set
from app.core.deps import get_current_user, require_project_access, require_project_role

router = APIRouter()


@router.post("/projects", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
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
def set_classes(
    project_id: int,
    classes: list[ClassIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_project_role(project_id, ["reviewer"], db, user)

    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")

    # If annotations exist, resetting classes would break FK / semantics.
    existing_class_ids = [r[0] for r in db.query(LabelClass.id).filter(LabelClass.project_id == project_id).all()]
    if existing_class_ids:
        has_any_annotations = (
            db.query(Annotation.id)
            .filter(Annotation.class_id.in_(existing_class_ids))
            .limit(1)
            .first()
            is not None
        )
        if has_any_annotations:
            raise HTTPException(
                status_code=409,
                detail="cannot reset classes because annotations already exist for this project; delete annotations/project first",
            )

    db.query(LabelClass).filter(LabelClass.project_id == project_id).delete(synchronize_session=False)
    for i, c in enumerate(classes):
        db.add(LabelClass(project_id=project_id, name=c.name, color=c.color, order_index=i))
    db.commit()

    return (
        db.query(LabelClass)
        .filter(LabelClass.project_id == project_id)
        .order_by(LabelClass.order_index.asc())
        .all()
    )


@router.get("/projects/{project_id}/classes", response_model=list[ClassOut])
def get_classes(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return (
        db.query(LabelClass)
        .filter(LabelClass.project_id == project_id)
        .order_by(LabelClass.order_index.asc())
        .all()
    )


@router.get("/projects/{project_id}/annotation-sets", response_model=list[AnnotationSetOut])
def list_annotation_sets(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    return (
        db.query(AnnotationSet)
        .filter(AnnotationSet.project_id == project_id)
        .order_by(AnnotationSet.id.asc())
        .all()
    )


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


@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Delete a project and all its associated data.

    Fixes FK violation like:
    annotations.class_id -> label_classes.id
    by deleting dependent tables first.
    """
    require_project_role(project_id, ["reviewer"], db, user)

    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="project not found")

    try:
        # Collect ids tied to this project
        dataset_ids = [r[0] for r in db.query(Dataset.id).filter(Dataset.project_id == project_id).all()]
        aset_ids = [r[0] for r in db.query(AnnotationSet.id).filter(AnnotationSet.project_id == project_id).all()]
        class_ids = [r[0] for r in db.query(LabelClass.id).filter(LabelClass.project_id == project_id).all()]

        item_ids: list[int] = []
        if dataset_ids:
            item_ids = [r[0] for r in db.query(DatasetItem.id).filter(DatasetItem.dataset_id.in_(dataset_ids)).all()]

        # 1) locks (if present)
        if item_ids or aset_ids:
            db.query(ItemLock).filter(
                or_(
                    ItemLock.dataset_item_id.in_(item_ids) if item_ids else False,
                    ItemLock.annotation_set_id.in_(aset_ids) if aset_ids else False,
                )
            ).delete(synchronize_session=False)

        # 2) annotations (KEY FIX: remove rows referencing label_classes before deleting label_classes)
        if item_ids or aset_ids or class_ids:
            db.query(Annotation).filter(
                or_(
                    Annotation.dataset_item_id.in_(item_ids) if item_ids else False,
                    Annotation.annotation_set_id.in_(aset_ids) if aset_ids else False,
                    Annotation.class_id.in_(class_ids) if class_ids else False,
                )
            ).delete(synchronize_session=False)

        # 3) dataset items -> datasets
        if item_ids:
            db.query(DatasetItem).filter(DatasetItem.id.in_(item_ids)).delete(synchronize_session=False)
        if dataset_ids:
            db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).delete(synchronize_session=False)

        # 4) annotation sets
        if aset_ids:
            db.query(AnnotationSet).filter(AnnotationSet.id.in_(aset_ids)).delete(synchronize_session=False)

        # 5) label classes
        if class_ids:
            db.query(LabelClass).filter(LabelClass.id.in_(class_ids)).delete(synchronize_session=False)

        # 6) jobs / weights (if present)
        db.query(Job).filter(Job.project_id == project_id).delete(synchronize_session=False)
        db.query(ModelWeight).filter(ModelWeight.project_id == project_id).delete(synchronize_session=False)

        # 7) members
        db.query(ProjectMember).filter(ProjectMember.project_id == project_id).delete(synchronize_session=False)

        # 8) finally project
        db.delete(p)
        db.commit()
        return {"status": "deleted"}

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"cannot delete project due to related records: {str(e.orig)}")


@router.delete("/projects/{project_id}/classes/{class_id}")
def delete_class(project_id: int, class_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Delete a single class from a project (blocked if annotations reference it)."""
    require_project_role(project_id, ["reviewer"], db, user)

    cls = db.query(LabelClass).filter(LabelClass.id == class_id, LabelClass.project_id == project_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="class not found")

    in_use = db.query(Annotation.id).filter(Annotation.class_id == class_id).limit(1).first() is not None
    if in_use:
        raise HTTPException(status_code=409, detail="cannot delete class because annotations reference it")

    db.delete(cls)
    db.commit()
    return {"status": "deleted"}
