from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import AuditLog, User
from app.core.deps import get_current_user, require_project_access

router = APIRouter()

@router.get("/projects/{project_id}/audit")
def list_audit(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user), limit: int = 200, offset: int = 0):
    require_project_access(project_id, db, user)
    q = (
        db.query(AuditLog)
        .filter(AuditLog.project_id == project_id)
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(min(limit, 500))
        .all()
    )
    return [
        {
            "id": a.id,
            "action": a.action,
            "entity_type": a.entity_type,
            "entity_id": a.entity_id,
            "user_id": a.user_id,
            "details": a.details,
            "created_at": a.created_at.isoformat(),
        }
        for a in q
    ]
