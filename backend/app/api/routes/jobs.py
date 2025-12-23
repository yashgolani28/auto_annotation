from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Job, Project
from app.schemas.schemas import AutoAnnotateRequest, JobOut
from app.workers.tasks import auto_annotate_task

router = APIRouter()

@router.post("/projects/{project_id}/jobs/auto-annotate", response_model=JobOut)
def start_auto_annotate(project_id: int, req: AutoAnnotateRequest, db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    job = Job(project_id=project_id, job_type="auto_annotate", status="queued", progress=0.0, payload=req.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    auto_annotate_task.delay(job.id)
    return job

@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job
