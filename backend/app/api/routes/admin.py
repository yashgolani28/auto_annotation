from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import User
from app.core.security import hash_password
from app.core.deps import require_global_roles

router = APIRouter()

@router.get("/admin/users", dependencies=[Depends(require_global_roles(["admin"]))])
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [{"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active} for u in users]

@router.post("/admin/users", dependencies=[Depends(require_global_roles(["admin"]))])
def create_user(payload: dict, db: Session = Depends(get_db)):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    name = payload.get("name") or ""
    role = payload.get("role") or "annotator"

    if not email or not password:
        raise HTTPException(status_code=400, detail="email + password required")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="email already exists")

    u = User(email=email, name=name, password_hash=hash_password(password), role=role, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role}

@router.patch("/admin/users/{user_id}", dependencies=[Depends(require_global_roles(["admin"]))])
def update_user(user_id: int, payload: dict, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="user not found")

    if "name" in payload:
        u.name = payload["name"] or ""
    if "role" in payload:
        u.role = payload["role"] or u.role
    if "is_active" in payload:
        u.is_active = bool(payload["is_active"])
    if "password" in payload and payload["password"]:
        u.password_hash = hash_password(payload["password"])

    db.add(u)
    db.commit()
    return {"status": "ok"}
