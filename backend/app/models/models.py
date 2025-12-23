from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String, Integer, DateTime, ForeignKey, Float, Boolean, Text, JSON, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


# ----------------------------- auth + org -----------------------------

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="admin")  # admin|reviewer|annotator|viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    memberships: Mapped[list["ProjectMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="annotator")  # reviewer|annotator|viewer
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="memberships")
    project: Mapped["Project"] = relationship(back_populates="members")


# ----------------------------- core entities -----------------------------

class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    task_type: Mapped[str] = mapped_column(String(32), default="detection")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    classes: Mapped[list["LabelClass"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    datasets: Mapped[list["Dataset"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    models: Mapped[list["ModelWeight"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    annotation_sets: Mapped[list["AnnotationSet"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    members: Mapped[list["ProjectMember"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class LabelClass(Base):
    __tablename__ = "label_classes"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_project_classname"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    color: Mapped[str] = mapped_column(String(16), default="#22c55e")
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped["Project"] = relationship(back_populates="classes")


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="datasets")
    items: Mapped[list["DatasetItem"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")


class DatasetItem(Base):
    __tablename__ = "dataset_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    rel_path: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(256))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    split: Mapped[str] = mapped_column(String(16), default="train")  # train|val|test
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    dataset: Mapped["Dataset"] = relationship(back_populates="items")


class ModelWeight(Base):
    __tablename__ = "model_weights"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    framework: Mapped[str] = mapped_column(String(32), default="ultralytics")
    rel_path: Mapped[str] = mapped_column(String(512))
    class_names: Mapped[dict] = mapped_column(JSON, default=dict)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="models")


class AnnotationSet(Base):
    __tablename__ = "annotation_sets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="default")
    source: Mapped[str] = mapped_column(String(32), default="manual")  # manual|auto|import
    model_weight_id: Mapped[Optional[int]] = mapped_column(ForeignKey("model_weights.id", ondelete="SET NULL"), nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # class_mapping, conf/iou, etc
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="annotation_sets")
    annotations: Mapped[list["Annotation"]] = relationship(back_populates="annotation_set", cascade="all, delete-orphan")


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annotation_set_id: Mapped[int] = mapped_column(ForeignKey("annotation_sets.id", ondelete="CASCADE"), index=True)
    dataset_item_id: Mapped[int] = mapped_column(ForeignKey("dataset_items.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("label_classes.id", ondelete="RESTRICT"), index=True)

    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)

    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    annotation_set: Mapped["AnnotationSet"] = relationship(back_populates="annotations")


# ----------------------------- collaboration -----------------------------

class AnnotationLock(Base):
    __tablename__ = "annotation_locks"
    __table_args__ = (UniqueConstraint("annotation_set_id", "dataset_item_id", name="uq_lock_item_set"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annotation_set_id: Mapped[int] = mapped_column(ForeignKey("annotation_sets.id", ondelete="CASCADE"), index=True)
    dataset_item_id: Mapped[int] = mapped_column(ForeignKey("dataset_items.id", ondelete="CASCADE"), index=True)
    locked_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    locked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)  # lease lock


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64))  # e.g., annotation.replace, dataset.split, import.yolo
    entity_type: Mapped[str] = mapped_column(String(64))  # annotation_set|item|export|dataset
    entity_id: Mapped[int] = mapped_column(Integer)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ----------------------------- jobs + exports -----------------------------

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    job_type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExportBundle(Base):
    __tablename__ = "exports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    annotation_set_id: Mapped[int] = mapped_column(ForeignKey("annotation_sets.id", ondelete="CASCADE"), index=True)
    fmt: Mapped[str] = mapped_column(String(16))
    rel_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
