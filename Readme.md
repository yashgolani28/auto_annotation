````md
# auto annotator (images + bbox + yolo + coco export)

a self-hosted auto-annotation + validation tool for object detection datasets.

**core flow**
1) create a project  
2) define classes (label names + colors)  
3) upload a dataset (zip of images)  
4) upload pretrained weights (ultralytics yolo `.pt`)  
5) run auto-annotation (optional)  
6) validate / edit bounding boxes in the web ui  
7) export in **yolo** or **coco** (zip)

---

## features

### ✅ dataset + annotation
- upload **zip of images** (jpg/png/webp/tiff/bmp)
- browser-based **bounding box editor**
  - draw boxes by click-drag
  - move boxes (drag)
  - resize boxes (transform handles)
  - delete selected box (del/backspace)
  - navigate images (left/right arrows)
  - save (ctrl+s)

### ✅ auto-annotation
- runs yolo inference via **ultralytics** on your uploaded images
- async job runner using **celery + redis**
- stores results in postgres

**important:** auto-annotation matches predictions to your project classes by **class name string match** (case-insensitive). if your yolo model predicts `car` but your project class is `Car` it will match. if it predicts `vehicle` but your project class is `car`, it will be ignored.

### ✅ exports
- **yolo** export
  - `images/train|val|test/`
  - `labels/train|val|test/` (one `.txt` per image)
  - `data.yaml`
- **coco** export
  - `images/`
  - `annotations.json` (coco bbox format)

---

## architecture

- **frontend**: react + vite + konva (bbox drawing)
- **backend**: fastapi + sqlalchemy
- **db**: postgres (projects, datasets, items, annotations, jobs, exports)
- **queue**: redis + celery worker (auto-annotate jobs)
- **storage**: local volume mounted at `./data` (images, models, exports)

---

## requirements

- docker desktop (linux engine)
- docker compose v2 (ships with docker desktop)
- recommended: 16 gb ram minimum (ultralytics + opencv can be heavy)

---

## quick start (docker)

> tip (windows): avoid spaces in folder names. use something like  
> `C:\ESSI\Projects\annotation_tool` instead of `annotation tool`

1) unzip the project
2) run:

```bash
docker compose up --build
````

3. open:

* ui: [http://localhost:5173](http://localhost:5173)
* api docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## configuration

compose services:

* postgres: `localhost:5432` (user/pass/db: `annotator`)
* redis: `localhost:6379`
* backend: `localhost:8000`
* frontend: `localhost:5173`

environment variables (set in `docker-compose.yml`)

### backend

* `DATABASE_URL`
* `STORAGE_DIR` (inside container, default `/app/data`)
* `CORS_ORIGINS` (default `http://localhost:5173`)
* `REDIS_URL`

### frontend

* `VITE_API_BASE` (default `http://localhost:8000`)

---

## folder structure

```
auto_annotator/
  docker-compose.yml
  backend/
    Dockerfile
    requirements.txt
    app/
      main.py
      api/
      models/
      schemas/
      services/
      workers/
  frontend/
    Dockerfile
    package.json
    src/
      pages/
      api.ts
  data/                      # persistent volume
    projects/
      <project_id>/
        datasets/<dataset_id>/images/*.jpg
        models/*.pt
    exports/
      project_<id>/dataset_<id>/aset_<id>/export_*.zip
```

---

## using the app (recommended workflow)

### 1) create project

* go to **home**
* enter name → create
* click **setup**

### 2) define classes

* in setup page, under “classes”
* one class per line, e.g.

  ```
  car
  truck
  bus
  motorbike
  plate
  ```

save classes.

### 3) upload dataset (zip)

prepare a zip containing only images (nested folders are ok, tool extracts images by filename).

* in setup page, “upload dataset”
* choose dataset name
* upload zip

**note:** right now every image is assigned to split=`train` by default. (see “splits” below)

### 4) upload pretrained weights

* upload `.pt` (recommended; auto-annotate uses ultralytics)
* `.onnx` upload is allowed for storage but **auto-annotate in this mvp supports only `.pt`**

### 5) auto-annotate (optional)

* open **auto**
* choose dataset + model + annotation set
* set conf/iou
* start job
* wait for progress to reach success

**class matching rule**

* model predicted class name must match project class name (case-insensitive)
* unmatched predicted classes are ignored

### 6) validate / edit annotations

* open **annotate**
* choose dataset, annotation set, active class
* draw/drag/resize boxes
* toggle “approved” per box (useful for exporting only validated bboxes)
* ctrl+s to save, or click save

shortcuts:

* **drag on empty space**: create bbox
* **del/backspace**: delete selected bbox
* **left/right arrow**: prev/next image
* **ctrl+s**: save

### 7) export

* open **export**
* choose dataset + annotation set
* options:

  * include images
  * approved only
* export yolo zip or coco zip
* download last export

---

## exports explained

### yolo format

label file: `labels/<split>/<image_stem>.txt`

each line:

```
<class_index> <x_center> <y_center> <width> <height>
```

all normalized to [0..1] relative to image width/height.

also generates `data.yaml`:

* train: `images/train`
* val: `images/val`
* test: `images/test`
* names: list of class names in the same order as your project classes

### coco format

creates:

* `annotations.json`
* `images/*.jpg`

bbox format:

```
[x, y, width, height]
```

in absolute pixel units (top-left origin).

---

## api reference (most useful endpoints)

base url: `http://localhost:8000`

### projects

* `POST /api/projects`
* `GET /api/projects`
* `GET /api/projects/{project_id}`

### classes

* `POST /api/projects/{project_id}/classes`
* `GET  /api/projects/{project_id}/classes`

### datasets

* `POST /api/projects/{project_id}/datasets`
* `GET  /api/projects/{project_id}/datasets`
* `POST /api/datasets/{dataset_id}/upload` (zip file)
* `GET  /api/datasets/{dataset_id}/items`

### models

* `POST /api/projects/{project_id}/models` (multipart: name + file)
* `GET  /api/projects/{project_id}/models`

### annotations

* `GET /api/items/{item_id}/annotations?annotation_set_id=...`
* `PUT /api/items/{item_id}/annotations?annotation_set_id=...`

### jobs

* `POST /api/projects/{project_id}/jobs/auto-annotate`
* `GET  /api/jobs/{job_id}`

### exports

* `POST /api/projects/{project_id}/exports`
* `GET  /api/exports/{export_id}/download`

### media

* `GET /media/items/{item_id}` (raw image)

---

## splits (train/val/test)

current behavior:

* all images are ingested with `split="train"`

best ways to handle splits right now:

1. export everything as train and split later in your training pipeline, or
2. manually update split in postgres (advanced), or
3. extend the tool to add:

   * a split assignment ui (per dataset)
   * auto random split (e.g., 80/10/10)

---

## common issues + fixes

### docker compose warning: “version is obsolete”

safe to ignore. you can remove this from `docker-compose.yml`:

```yaml
version: "3.9"
```

### build fails with: `lookup auth.docker.io: no such host`

this is dns/network (docker hub unreachable).

fixes:

* try a different network/hotspot (to confirm firewall)
* set docker desktop dns:

  * docker desktop → settings → docker engine:

    ```json
    { "dns": ["1.1.1.1", "8.8.8.8"] }
    ```
  * apply & restart

### slow build on first run

backend installs ultralytics + opencv + numpy which can be large. subsequent builds are faster due to cache.

### auto-annotate produces no boxes

common reasons:

* project class names don’t match model class names
* conf too high (try 0.15–0.25)
* model isn’t detection or weights incompatible

### can’t see images in ui

* confirm backend is running on `http://localhost:8000`
* check `VITE_API_BASE` in frontend env (compose sets it)
* check browser console for 404s

---

## limitations (current mvp)

* auto-annotate supports only ultralytics `.pt` weights (not onnx)
* no segmentation or keypoints (detection only)
* no importing existing yolo/coco labels yet
* no dataset split management ui (everything defaults to train)
* no role-based auth (it’s a local tool)

---

## roadmap (recommended upgrades)

if you want this to feel like a “best-in-class” internal tool, these are the next moves:

* dataset splits ui (random split + manual override)
* import yolo + coco into annotation sets
* label hotkeys (1..9), box copy/duplicate, box nudge with arrows
* zoom/pan canvas, snap-to-edge, min box size
* class mapping ui for auto-annotation (map model classes → project classes)
* active learning: sort images by low-confidence, quick approve queue
* multi-user auth + audit log
* model registry + model versioning meta (run, dataset hash, etc.)
* export to additional formats (pascal voc, labelme, roboflow json)

---

## dev mode (optional)

if you want to run without docker:

### backend

* python 3.11
* postgres + redis running
* set env vars:

  * `DATABASE_URL=postgresql+psycopg://...`
  * `REDIS_URL=redis://...`
  * `STORAGE_DIR=...`
* run:

```bash
uvicorn app.main:app --reload --port 8000
celery -A app.workers.celery_app.celery worker --loglevel=INFO
```

### frontend

```bash
npm install
npm run dev -- --port 5173
```

---

## license / internal use

use internally as needed. if you plan to ship externally, add auth, rate limits, and storage hardening first.

```
```
