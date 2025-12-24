import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.models import Job

router = APIRouter(prefix="/ws")

@router.websocket("/jobs/{job_id}")
async def ws_job_progress(ws: WebSocket, job_id: int):
    await ws.accept()
    try:
        last = None
        while True:
            db: Session = SessionLocal()
            try:
                job = db.query(Job).filter(Job.id == job_id).first()
                if not job:
                    await ws.send_json({"id": job_id, "status": "missing", "progress": 0.0, "message": "job not found"})
                    await asyncio.sleep(1.0)
                    continue

                payload = {
                    "id": job.id,
                    "status": job.status,
                    "progress": job.progress,
                    "message": job.message or "",
                }

                if payload != last:
                    await ws.send_json(payload)
                    last = payload

                if job.status in ("success", "done", "failed", "canceled"):
                    break
            finally:
                db.close()

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return
