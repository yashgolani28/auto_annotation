from fastapi import APIRouter
from app.api.routes import projects, datasets, models, annotations, jobs, exports, media, auth, admin, imports, audit, locks, ws

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(admin.router, tags=["admin"])
api_router.include_router(projects.router, tags=["projects"])
api_router.include_router(datasets.router, tags=["datasets"])
api_router.include_router(models.router, tags=["models"])
api_router.include_router(annotations.router, tags=["annotations"])
api_router.include_router(jobs.router, tags=["jobs"])
api_router.include_router(exports.router, tags=["exports"])
api_router.include_router(imports.router, tags=["imports"])
api_router.include_router(audit.router, tags=["audit"])
api_router.include_router(locks.router, tags=["locks"])

media_router = APIRouter()
media_router.include_router(media.router, tags=["media"])

ws_router = APIRouter()
ws_router.include_router(ws.router, tags=["ws"])
