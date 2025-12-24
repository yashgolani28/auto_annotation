from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Job, Project
from app.schemas.schemas import AutoAnnotateRequest, JobOut
from app.workers.tasks import auto_annotate_task
from app.core.deps import get_current_user, require_project_access
from app.models.models import User

router = APIRouter()

@router.post("/projects/{project_id}/jobs/auto-annotate", response_model=JobOut)
def start_auto_annotate(project_id: int, req: AutoAnnotateRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    job = Job(project_id=project_id, job_type="auto_annotate", status="queued", progress=0.0, payload=req.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    auto_annotate_task.delay(job.id)
    return job

@router.get("/projects/{project_id}/jobs", response_model=list[JobOut])
def list_project_jobs(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_project_access(project_id, db, user)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="project not found")
    return db.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at.desc()).limit(200).all()

@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    require_project_access(job.project_id, db, user)
    return job
