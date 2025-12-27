from celery import Celery
from app.core.config import settings

celery = Celery(
    "auto_annotator",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery.conf.update(
    task_track_started=True,
    worker_prefetch_multiplier=1,
)