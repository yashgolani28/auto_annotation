from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Job, Project
from app.schemas.schemas import AutoAnnotateRequest, JobOut, TrainYoloRequest
from app.core.deps import get_current_user, require_project_access
from app.models.models import User, Job
from datetime import datetime
from app.workers.celery_app import celery

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
    celery.send_task("auto_annotate_task", args=[job.id])
    return job

@router.post("/projects/{project_id}/jobs/train-yolo", response_model=JobOut)
def start_train_yolo(project_id: int, payload: TrainYoloRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = Job(
        project_id=project_id,
        job_type="train_yolo",
        status="queued",
        progress=0.0,
        message="queued",
        payload=payload.model_dump(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    celery.send_task("train_yolo_task", args=[job.id])
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
