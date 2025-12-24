# Auto Annotator

A self-hosted annotation tool for object detection datasets with YOLO auto-annotation, web-based validation, and export to YOLO/COCO formats.

## Overview

Auto Annotator streamlines the creation of object detection datasets by combining automated labeling with manual validation. Upload images, run YOLO inference to generate initial annotations, validate and correct them in a browser-based editor, then export to standard formats.

**Key capabilities:**
- Browser-based bounding box editor with intuitive controls
- Automated annotation using pretrained YOLO models
- Export to YOLO or COCO formats
- Async job processing for large datasets
- Dockerized deployment with persistent storage

## Quick Start

**Prerequisites:** Docker Desktop with 16GB+ RAM recommended

```bash
# Clone and start
docker compose up --build

# Access the application
UI:       http://localhost:5173
API Docs: http://localhost:8000/docs
```

## Workflow

### 1. Create Project & Define Classes

Create a new project and define your object classes:

```
car
truck
bus
motorbike
license_plate
```

### 2. Upload Dataset

Prepare a zip file containing your images (JPG, PNG, WebP, TIFF, BMP). Nested folders are supported—images are extracted by filename.

### 3. Upload Model Weights

Upload pretrained YOLO weights (`.pt` format) for auto-annotation.

### 4. Run Auto-Annotation

Configure and run inference:
- Select dataset and model
- Set confidence threshold (recommended: 0.15-0.25)
- Set IoU threshold
- Monitor job progress

**Class Matching:** Predictions are matched to project classes by name (case-insensitive). Unmatched classes are ignored.

### 5. Validate & Edit

Use the annotation editor to refine results:
- **Click-drag** on empty space to draw boxes
- **Drag** boxes to reposition
- **Resize** using corner handles
- **Delete** selected box with Del/Backspace
- **Navigate** images with arrow keys
- **Save** with Ctrl+S

Mark boxes as "approved" to export only validated annotations.

### 6. Export

Export your dataset in YOLO or COCO format:
- **YOLO**: Images organized by split, normalized txt labels, data.yaml
- **COCO**: Images folder with annotations.json

Options:
- Include/exclude images
- Export approved annotations only

## Architecture

```
Frontend:  React + Vite + Konva (canvas-based editing)
Backend:   FastAPI + SQLAlchemy
Database:  PostgreSQL
Queue:     Redis + Celery (async jobs)
Storage:   Local volume at ./data
```

## Export Formats

### YOLO Format

```
dataset/
├── images/
│   ├── train/*.jpg
│   ├── val/*.jpg
│   └── test/*.jpg
├── labels/
│   ├── train/*.txt
│   ├── val/*.txt
│   └── test/*.txt
└── data.yaml
```

Label format (normalized 0-1):
```
<class_idx> <x_center> <y_center> <width> <height>
```

### COCO Format

```
dataset/
├── images/*.jpg
└── annotations.json
```

Bounding boxes in absolute pixels: `[x, y, width, height]`

## Configuration

Key environment variables (set in `docker-compose.yml`):

**Backend:**
- `DATABASE_URL`: PostgreSQL connection string
- `STORAGE_DIR`: Persistent storage path (default: `/app/data`)
- `REDIS_URL`: Redis connection for job queue
- `CORS_ORIGINS`: Allowed frontend origins

**Frontend:**
- `VITE_API_BASE`: Backend API URL (default: `http://localhost:8000`)

## API Reference

Key endpoints:

```
POST   /api/projects                              Create project
GET    /api/projects/{id}                         Get project details
POST   /api/projects/{id}/classes                 Add classes
POST   /api/projects/{id}/datasets                Create dataset
POST   /api/datasets/{id}/upload                  Upload images (zip)
POST   /api/projects/{id}/models                  Upload model weights
GET    /api/datasets/{id}/items                   List dataset images
POST   /api/projects/{id}/jobs/auto-annotate      Start auto-annotation
GET    /api/jobs/{id}                             Check job status
GET    /api/items/{id}/annotations                Get annotations
PUT    /api/items/{id}/annotations                Save annotations
POST   /api/projects/{id}/exports                 Create export
GET    /api/exports/{id}/download                 Download export zip
GET    /media/items/{id}                          Retrieve image
```

Full API documentation: http://localhost:8000/docs

## Troubleshooting

**Docker build fails with DNS errors:**
- Check network connectivity to Docker Hub
- Configure Docker DNS: Settings → Docker Engine → Add `{"dns": ["1.1.1.1", "8.8.8.8"]}`

**Auto-annotation produces no results:**
- Verify project class names match model class names (case-insensitive)
- Lower confidence threshold (try 0.15-0.25)
- Confirm model is for object detection

**Images not loading in UI:**
- Verify backend is accessible at `http://localhost:8000`
- Check browser console for network errors
- Confirm `VITE_API_BASE` environment variable

**Slow initial build:**
- First build installs large dependencies (Ultralytics, OpenCV)
- Subsequent builds use Docker cache and complete faster

## Current Limitations

- Auto-annotation supports only Ultralytics `.pt` weights (ONNX upload allowed but not used)
- Detection only (no segmentation or keypoints)
- No import of existing YOLO/COCO annotations
- All images default to "train" split—no split management UI
- Single-user tool (no authentication)

## Roadmap

Potential enhancements for production use:

**Workflow improvements:**
- Dataset split management (random split, manual assignment)
- Import existing YOLO/COCO labels
- Keyboard shortcuts for classes (1-9), box duplication, nudging
- Canvas zoom/pan, grid snap, minimum box size constraints

**Auto-annotation:**
- Class mapping UI (map model classes to project classes)
- Active learning (prioritize low-confidence predictions)
- Batch processing optimizations

**Enterprise features:**
- Multi-user authentication and role-based access
- Audit logging
- Model registry with versioning
- Additional export formats (Pascal VOC, LabelMe, Roboflow)

## Development Mode

Run without Docker for development:

**Backend:**
```bash
# Requirements: Python 3.11, PostgreSQL, Redis
export DATABASE_URL=postgresql+psycopg://annotator:annotator@localhost/annotator
export REDIS_URL=redis://localhost:6379
export STORAGE_DIR=./data

uvicorn app.main:app --reload --port 8000
celery -A app.workers.celery_app.celery worker --loglevel=INFO
```

**Frontend:**
```bash
npm install
npm run dev -- --port 5173
```

---

## license / internal use

use internally as needed. if you plan to ship externally, add auth, rate limits, and storage hardening first.

```
```
