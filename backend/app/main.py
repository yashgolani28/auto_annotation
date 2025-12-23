from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def _startup():
    ensure_dirs()
    init_db()

app.include_router(api_router)
app.include_router(media_router)
app.include_router(ws_router)
