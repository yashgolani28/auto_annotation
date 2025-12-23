from __future__ import annotations
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.security import decode_token
from app.models.models import User, ProjectMember, Project

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="not authenticated")

    try:
        payload = decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="invalid token type")

    uid = int(payload.get("sub"))
    user = db.query(User).filter(User.id == uid, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return user


def require_global_roles(roles: list[str]):
    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="forbidden")
        return user
    return _dep


def require_project_role(project_id: int, roles: list[str], db: Session, user: User):
    if user.role == "admin":
        return
    m = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
    if not m or m.role not in roles:
        raise HTTPException(status_code=403, detail="forbidden")


def require_project_access(project_id: int, db: Session, user: User):
    if user.role == "admin":
        return
    m = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
    if not m:
        raise HTTPException(status_code=403, detail="no project access")


def get_project_or_404(project_id: int, db: Session) -> Project:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return p
