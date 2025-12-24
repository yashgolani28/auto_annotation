from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ProjectCreate(BaseModel):
    name: str
    task_type: str = "detection"

class ProjectOut(BaseModel):
    id: int
    name: str
    task_type: str
    class Config:
        from_attributes = True

class ClassIn(BaseModel):
    name: str
    color: str = "#22c55e"

class ClassOut(BaseModel):
    id: int
    name: str
    color: str
    order_index: int
    class Config:
        from_attributes = True

class DatasetCreate(BaseModel):
    name: str

class DatasetOut(BaseModel):
    id: int
    name: str
    project_id: int
    class Config:
        from_attributes = True

class DatasetItemOut(BaseModel):
    id: int
    file_name: str
    width: int
    height: int
    split: str
    class Config:
        from_attributes = True

class ModelOut(BaseModel):
    id: int
    name: str
    framework: str
    class_names: Dict[str, str] = Field(default_factory=dict)
    class Config:
        from_attributes = True

class AnnotationSetOut(BaseModel):
    id: int
    name: str
    source: str
    model_weight_id: Optional[int] = None
    class Config:
        from_attributes = True

class AnnotationIn(BaseModel):
    id: Optional[int] = None
    class_id: int
    x: float
    y: float
    w: float
    h: float
    confidence: Optional[float] = None
    approved: bool = False
    attributes: Optional[dict] = None

class AnnotationOut(AnnotationIn):
    id: int

class JobOut(BaseModel):
    id: int
    job_type: str
    status: str
    progress: float
    message: str
    payload: dict
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True

class AutoAnnotateRequest(BaseModel):
    model_id: int
    dataset_id: int
    annotation_set_id: Optional[int] = None
    conf: float = 0.25
    iou: float = 0.5
    device: str = ""
    # optional extra parameters, e.g. {"class_mapping": {"model_name": "project_name"}}
    params: Dict[str, Any] = Field(default_factory=dict)

class ExportRequest(BaseModel):
    dataset_id: int
    annotation_set_id: int
    fmt: str
    include_images: bool = True
    approved_only: bool = False

class ExportOut(BaseModel):
    id: int
    fmt: str
    class Config:
        from_attributes = True
