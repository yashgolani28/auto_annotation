from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.router import api_router, media_router
from app.db.init_db import init_db
from app.services.storage import ensure_dirs

app = FastAPI(title="Auto Annotator", version="0.1.0")

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
