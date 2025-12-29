# app/api/routes/auth.py
import json
import os
import time
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.deps import get_current_user
from app.models.models import User

router = APIRouter(prefix="/auth")


# ---------------------------------------------------------------------
# safe debug logger (won't crash in docker/linux)
# ---------------------------------------------------------------------
def _debug_log(location: str, message: str, data: dict):
    """
    Writes JSON lines to a debug file ONLY if it can.
    - Uses DEBUG_LOG_PATH env var if set
    - Otherwise tries a local relative path: .cursor/debug.log
    - Never raises (so auth endpoints won't 500)
    """
    try:
        log_path = os.getenv("DEBUG_LOG_PATH", "")
        if log_path:
            p = Path(log_path)
        else:
            p = Path(".cursor") / "debug.log"

        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
            "sessionId": "debug-session",
            "runId": "post-fix",
        }
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------
# schemas
# ---------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


# ---------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------
@router.post("/login")
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    _debug_log(
        "auth.py:/login:entry",
        "login endpoint entry",
        {
            "hasCredentials": credentials is not None,
            "email": credentials.email if credentials else None,
            "passwordLength": len(credentials.password) if credentials else 0,
        },
    )

    _debug_log(
        "auth.py:/login:before_query",
        "before user query",
        {"email": credentials.email},
    )

    user = db.query(User).filter(User.email == credentials.email).first()

    _debug_log(
        "auth.py:/login:after_query",
        "after user query",
        {
            "userFound": user is not None,
            "userId": user.id if user else None,
            "userEmail": user.email if user else None,
            "role": getattr(user, "role", None) if user else None,
        },
    )

    if not user or not verify_password(credentials.password, user.password_hash):
        _debug_log(
            "auth.py:/login:failed",
            "authentication failed",
            {
                "userExists": user is not None,
                "passwordMatch": verify_password(credentials.password, user.password_hash) if user else False,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        )

    _debug_log(
        "auth.py:/login:tokens",
        "authentication success, creating tokens",
        {"userId": user.id},
    )

    access = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "is_admin": user.role == "admin"},
    )
    refresh = create_refresh_token(
        subject=str(user.id),
        extra={"email": user.email, "is_admin": user.role == "admin"},
    )

    _debug_log(
        "auth.py:/login:success",
        "login endpoint success",
        {"hasAccessToken": bool(access), "hasRefreshToken": bool(refresh)},
    )

    # ✅ IMPORTANT: frontend expects r.data.user (auth.tsx)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": getattr(user, "name", None) or "Admin",
            "role": user.role,
        },
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    # ✅ used by auth.tsx hydrate(): GET /api/auth/me
    return {
        "id": user.id,
        "email": user.email,
        "name": getattr(user, "name", None) or "Admin",
        "role": user.role,
    }


@router.post("/logout")
def logout(_: LogoutRequest):
    return {"status": "ok"}


@router.post("/refresh")
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    token = payload.refresh_token
    if not token:
        raise HTTPException(status_code=400, detail="refresh_token required")

    data = decode_token(token, expected_type="refresh")
    user_id = int(data["sub"])

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="invalid refresh token")

    access = create_access_token(
        subject=str(user.id),
        extra={"email": user.email, "is_admin": user.role == "admin"},
    )
    return {"access_token": access, "token_type": "bearer"}
