import json
import time
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.api.router import api_router, media_router, ws_router
from app.db.init_db import init_db
from app.services.storage import ensure_dirs

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Auto Annotator", version="2.0.0")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # #region agent log
        try:
            with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location":"main.py:middleware","message":"incoming request","data":{"path":str(request.url.path),"method":request.method,"headers":dict(request.headers)},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run2","hypothesisId":"B"})+'\n')
        except: pass
        # #endregion
        try:
            response = await call_next(request)
            # #region agent log
            try:
                with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
                    f.write(json.dumps({"location":"main.py:middleware","message":"request completed","data":{"path":str(request.url.path),"statusCode":response.status_code},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run2","hypothesisId":"B"})+'\n')
            except: pass
            # #endregion
            return response
        except Exception as e:
            # #region agent log
            try:
                with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
                    f.write(json.dumps({"location":"main.py:middleware","message":"request exception","data":{"path":str(request.url.path),"error":str(e)},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run2","hypothesisId":"B"})+'\n')
            except: pass
            # #endregion
            raise

app.add_middleware(RequestLoggingMiddleware)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # #region agent log
    try:
        with open(r'c:\ESSI\Projects\annotation_tool\.cursor\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"main.py:validation_handler","message":"request validation error","data":{"path":str(request.url.path),"method":request.method,"errors":exc.errors()},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run2","hypothesisId":"A"})+'\n')
    except: pass
    # #endregion
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": exc.errors()})

@app.on_event("startup")
def _startup():
    ensure_dirs()
    init_db()

app.include_router(api_router)
app.include_router(media_router)
app.include_router(ws_router)
