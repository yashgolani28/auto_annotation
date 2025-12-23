from __future__ import annotations
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.models import Job

router = APIRouter()

@router.websocket("/ws/jobs/{job_id}")
async def ws_job(websocket: WebSocket, job_id: int):
    await websocket.accept()
    try:
        while True:
            db: Session = SessionLocal()
            try:
                job = db.query(Job).filter(Job.id == job_id).first()
                if not job:
                    await websocket.send_json({"error": "job not found"})
                    await asyncio.sleep(1.0)
                    continue
                await websocket.send_json({
                    "id": job.id,
                    "status": job.status,
                    "progress": job.progress,
                    "message": job.message,
                    "updated_at": job.updated_at.isoformat(),
                })
                if job.status in ("success", "failed"):
                    break
            finally:
                db.close()
            await asyncio.sleep(0.8)
    except WebSocketDisconnect:
        return
