import json
import os
import time
from typing import List

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.router import api_router, media_router, ws_router
from app.core.config import settings
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
            with open(
                r"c:\ESSI\Projects\annotation_tool\.cursor\debug.log",
                "a",
                encoding="utf-8",
            ) as f:
                f.write(
                    json.dumps(
                        {
                            "location": "main.py:middleware",
                            "message": "incoming request",
                            "data": {
                                "path": str(request.url.path),
                                "method": request.method,
                                "headers": dict(request.headers),
                            },
                            "timestamp": int(time.time() * 1000),
                            "sessionId": "debug-session",
                            "runId": "run2",
                            "hypothesisId": "B",
                        }
                    )
                    + "\n"
                )
        except:
            pass
        # #endregion
        try:
            response = await call_next(request)
            # #region agent log
            try:
                with open(
                    r"c:\ESSI\Projects\annotation_tool\.cursor\debug.log",
                    "a",
                    encoding="utf-8",
                ) as f:
                    f.write(
                        json.dumps(
                            {
                                "location": "main.py:middleware",
                                "message": "request completed",
                                "data": {
                                    "path": str(request.url.path),
                                    "statusCode": response.status_code,
                                },
                                "timestamp": int(time.time() * 1000),
                                "sessionId": "debug-session",
                                "runId": "run2",
                                "hypothesisId": "B",
                            }
                        )
                        + "\n"
                    )
            except:
                pass
            # #endregion
            return response
        except Exception as e:
            # #region agent log
            try:
                with open(
                    r"c:\ESSI\Projects\annotation_tool\.cursor\debug.log",
                    "a",
                    encoding="utf-8",
                ) as f:
                    f.write(
                        json.dumps(
                            {
                                "location": "main.py:middleware",
                                "message": "request exception",
                                "data": {"path": str(request.url.path), "error": str(e)},
                                "timestamp": int(time.time() * 1000),
                                "sessionId": "debug-session",
                                "runId": "run2",
                                "hypothesisId": "B",
                            }
                        )
                        + "\n"
                    )
            except:
                pass
            # #endregion
            raise


app.add_middleware(RequestLoggingMiddleware)


def _parse_cors_origins(raw: str) -> List[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    # support JSON list in env: ["http://localhost:5173", ...]
    if raw.startswith("["):
        try:
            v = json.loads(raw)
            if isinstance(v, list):
                return [str(x).strip() for x in v if str(x).strip()]
        except Exception:
            pass
    # comma-separated
    return [o.strip() for o in raw.split(",") if o.strip()]


# Prefer env var (docker-compose), fall back to settings
raw_cors = os.getenv("CORS_ORIGINS") or getattr(settings, "cors_origins", "") or ""
origins = _parse_cors_origins(raw_cors)

# dev fallback so local frontend always works (never return empty origins)
if not origins:
    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
else:
    # ensure local dev is allowed even if cors_origins is set but missing these
    for o in ["http://localhost:5173", "http://127.0.0.1:5173"]:
        if o not in origins:
            origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# log at startup so you can verify it inside the container logs
print(f"[CORS] raw={raw_cors!r} allow_origins={origins}")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # #region agent log
    try:
        with open(
            r"c:\ESSI\Projects\annotation_tool\.cursor\debug.log",
            "a",
            encoding="utf-8",
        ) as f:
            f.write(
                json.dumps(
                    {
                        "location": "main.py:validation_handler",
                        "message": "request validation error",
                        "data": {
                            "path": str(request.url.path),
                            "method": request.method,
                            "errors": exc.errors(),
                        },
                        "timestamp": int(time.time() * 1000),
                        "sessionId": "debug-session",
                        "runId": "run2",
                        "hypothesisId": "A",
                    }
                )
                + "\n"
            )
    except:
        pass
    # #endregion
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": exc.errors()}
    )


@app.on_event("startup")
def _startup():
    ensure_dirs()
    init_db()


app.include_router(api_router)
app.include_router(media_router)
app.include_router(ws_router)
