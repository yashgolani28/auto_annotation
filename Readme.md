# Auto Annotator

A self-hosted annotation and training platform for object detection datasets with YOLO auto-annotation, web-based validation, model fine-tuning, and export to YOLO/COCO formats.

## Overview

Auto Annotator streamlines the full lifecycle of object detection datasets:

* automated labeling using pretrained YOLO models
* manual validation and correction in a browser-based editor
* fine-tuning YOLO models on validated annotations
* exporting datasets and trained models for downstream use

It is designed for **local, GPU-accelerated workflows** and scales well to large datasets using async job processing.

**Key capabilities:**

* Browser-based bounding box editor with intuitive controls
* YOLO-based auto-annotation
* YOLO fine-tuning (train + benchmark from UI)
* Export to YOLO or COCO formats
* Async job processing via Celery
* GPU acceleration (CUDA / NVIDIA)
* Fully Dockerized with persistent storage

---

## Quick Start

### Prerequisites

* Docker Desktop
* **NVIDIA GPU (recommended)**
* **NVIDIA drivers installed on host**
* **Docker Desktop with GPU support enabled**
* 16 GB+ RAM recommended

> Tested with RTX 30xx / 40xx series (e.g. RTX 4060 Ti)

---

### Start the stack

```bash
docker compose up --build
```

### Access

```
UI:        http://localhost:5173
API Docs:  http://localhost:8000/docs
```

---

## GPU / CUDA Support (Important)

Auto Annotator supports **GPU-accelerated inference and training** inside Docker.

### What’s required

1. NVIDIA GPU + drivers on host
2. Docker Desktop with GPU support enabled
3. CUDA-enabled PyTorch inside containers

The provided `docker-compose.yml` and backend `Dockerfile` are already configured for this.

### Verify GPU inside container

```bash
docker compose exec worker python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu')"
```

Expected:

```
True NVIDIA GeForce RTX 4060 Ti
```

If CUDA is not detected, see **Troubleshooting → GPU issues** below.

---

## Workflow

### 1. Create Project & Define Classes

Create a project and define detection classes:

```
car
truck
bus
motorbike
license_plate
```

Class order matters — it defines YOLO class indices.

---

### 2. Upload Dataset

Upload a `.zip` containing images:

* JPG, PNG, WebP, TIFF, BMP supported
* Nested folders supported
* Images are indexed and stored persistently

---

### 3. Upload Model Weights

Upload pretrained YOLO `.pt` weights:

* Ultralytics YOLO detection models
* These are used for auto-annotation or as base models for training

---

### 4. Run Auto-Annotation

Configure inference:

* Dataset
* Model
* Confidence threshold (recommended: `0.15–0.25`)
* IoU threshold
* Device (`cpu` or `0` for GPU)

Jobs run asynchronously via Celery.

**Class Matching**

* Model class names are matched to project classes (case-insensitive)
* Unmatched predictions are skipped

---

### 5. Validate & Edit Annotations

Use the browser editor:

* **Click + drag** to draw boxes
* **Drag** to move boxes
* **Resize** using handles
* **Delete** with `Del` / `Backspace`
* **Navigate** images with arrow keys
* **Save** with `Ctrl + S`

Only **approved** annotations are used for training or export (optional).

---

### 6. Train YOLO (Fine-tuning)

Train a new YOLO model directly from validated annotations.

**From the UI:**

* Select dataset
* Select annotation set
* Select base model
* Configure:

  * image size
  * epochs
  * batch size
  * optimizer
  * device (`cpu` or `0`)
* Start training job

**What happens:**

* Dataset is exported from DB → YOLO format
* Model is fine-tuned
* Validation + YOLO benchmark is run
* Trained `.pt` is stored and registered as a new model

Training jobs support:

* GPU acceleration
* Automatic batch-size fallback on OOM
* Progress + logs in UI

---

### 7. Export

Export datasets:

**YOLO**

```
dataset/
├── images/{train,val,test}
├── labels/{train,val,test}
└── data.yaml
```

Label format:

```
<class_idx> <x_center> <y_center> <width> <height>
```

**COCO**

```
dataset/
├── images/
└── annotations.json
```

---

## Architecture

```
Frontend:  React + Vite + Konva
Backend:   FastAPI + SQLAlchemy
Database:  PostgreSQL
Queue:     Redis + Celery
ML Stack:  Ultralytics YOLO + PyTorch (CUDA)
Storage:   Local volume (./data)
```

---

## Configuration

Key environment variables (via `docker-compose.yml`):

### Backend

* `DATABASE_URL`
* `STORAGE_DIR`
* `REDIS_URL`
* `CORS_ORIGINS`
* `JWT_SECRET`

### Frontend

* `VITE_API_BASE`

---

## API Reference

Key endpoints:

```
POST   /api/projects/{id}/jobs/auto-annotate
POST   /api/projects/{id}/jobs/train-yolo
GET    /api/projects/{id}/jobs
GET    /api/jobs/{id}
POST   /api/projects/{id}/exports
GET    /media/items/{id}
```

Full docs:
[http://localhost:8000/docs](http://localhost:8000/docs)

---

## Troubleshooting

### GPU not detected in container

Run:

```bash
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

If this fails:

* Install NVIDIA drivers
* Enable GPU support in Docker Desktop
* Restart Docker Desktop

---

### CUDA error: `torch.cuda.is_available(): False`

* Ensure backend image uses **CUDA PyTorch**
* Rebuild with `--no-cache`
* Confirm `gpus: all` in `docker-compose.yml`

---

### Auto-annotation produces no results

* Lower confidence threshold
* Check class-name matching
* Confirm model is detection (not classification)

---

### Training fails with CUDA OOM

* Reduce batch size
* Enable auto fallback (already supported)
* Close other GPU-heavy apps

---

## Current Limitations

* Detection only (no segmentation / keypoints)
* Ultralytics `.pt` only
* No dataset split UI (yet)
* Single-user (auth is basic)
* Local storage only

---

## Roadmap

* Dataset split manager
* Import existing YOLO / COCO labels
* Class-mapping UI
* Active learning
* Multi-user RBAC
* Model versioning
* Cloud/object storage support

---

## Development Mode (No Docker)

**Backend**

```bash
uvicorn app.main:app --reload
celery -A app.workers.celery_app.celery worker --loglevel=INFO
```

**Frontend**

```bash
npm install
npm run dev
```

---

## License / Internal Use

Internal use only.
Before external deployment: add auth hardening, rate limits, and secure storage.

---

