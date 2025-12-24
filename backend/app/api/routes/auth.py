import json
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.models import User

router = APIRouter(prefix="/auth")

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    # #region agent log
    with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
        f.write(json.dumps({"location":"auth.py:15","message":"login endpoint entry","data":{"hasCredentials":credentials is not None,"email":credentials.email if credentials else None,"passwordLength":len(credentials.password) if credentials else 0},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"A"})+'\n')
    # #endregion
    # #region agent log
    with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
        f.write(json.dumps({"location":"auth.py:17","message":"before user query","data":{"email":credentials.email},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"D"})+'\n')
    # #endregion
    user = db.query(User).filter(User.email == credentials.email).first()
    # #region agent log
    with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
        f.write(json.dumps({"location":"auth.py:18","message":"after user query","data":{"userFound":user is not None,"userId":user.id if user else None,"userEmail":user.email if user else None},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"D"})+'\n')
    # #endregion
    if not user or not verify_password(credentials.password, user.password_hash):
        # #region agent log
        with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"auth.py:19","message":"authentication failed","data":{"userExists":user is not None,"passwordMatch":verify_password(credentials.password, user.password_hash) if user else False},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"D"})+'\n')
        # #endregion
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    # #region agent log
    with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
        f.write(json.dumps({"location":"auth.py:22","message":"authentication success, creating tokens","data":{"userId":user.id},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"A"})+'\n')
    # #endregion
    access = create_access_token(subject=str(user.id), extra={"email": user.email, "is_admin": user.role == "admin"})
    refresh = create_refresh_token(subject=str(user.id), extra={"email": user.email, "is_admin": user.role == "admin"})
    # #region agent log
    with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
        f.write(json.dumps({"location":"auth.py:25","message":"login endpoint success","data":{"hasAccessToken":bool(access),"hasRefreshToken":bool(refresh)},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"post-fix","hypothesisId":"A"})+'\n')
    # #endregion
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}

@router.post("/refresh")
def refresh(payload: dict, db: Session = Depends(get_db)):
    token = payload.get("refresh_token")
    if not token:
        raise HTTPException(status_code=400, detail="refresh_token required")

    data = decode_token(token, expected_type="refresh")
    user_id = int(data["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="invalid refresh token")

    access = create_access_token(subject=str(user.id), extra={"email": user.email, "is_admin": user.role == "admin"})
    return {"access_token": access, "token_type": "bearer"}
