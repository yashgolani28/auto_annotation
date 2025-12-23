from fastapi import APIRouter
from app.api.routes import projects, datasets, models, annotations, jobs, exports, media

api_router = APIRouter(prefix="/api")
api_router.include_router(projects.router, tags=["projects"])
api_router.include_router(datasets.router, tags=["datasets"])
api_router.include_router(models.router, tags=["models"])
api_router.include_router(annotations.router, tags=["annotations"])
api_router.include_router(jobs.router, tags=["jobs"])
api_router.include_router(exports.router, tags=["exports"])

media_router = APIRouter()
media_router.include_router(media.router, tags=["media"])
