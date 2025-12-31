import os
import json
import csv
import threading
import math
import time
import random
import shutil
import hashlib
import platform
from pathlib import Path
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

import torch
try:
    import torch.multiprocessing as _tmp_mp  # type: ignore
    _strategy = os.environ.get("TORCH_SHARING_STRATEGY", "").strip()
    if _strategy:
        _tmp_mp.set_sharing_strategy(_strategy)
except Exception:
    pass
from ultralytics import YOLO

from app.workers.celery_app import celery
from app.db.session import SessionLocal
from app.models.models import Job, Dataset, DatasetItem, ModelWeight, LabelClass, AnnotationSet, Annotation, Project
from app.core.config import settings
from app.services.inference import load_ultralytics_model, predict_bboxes
from app.services.model_metadata_check import check_model_metadata


# ---------------------------------------------------------------------
# utils
# ---------------------------------------------------------------------

def _update_job(
    db: Session,
    job: Job,
    status: str | None = None,
    progress: float | None = None,
    message: str | None = None,
):
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = float(progress)
    if message is not None:
        job.message = message
    job.updated_at = datetime.utcnow()
    db.add(job)
    db.commit()


def _merge_job_payload(db: Session, job: Job, patch: dict[str, Any]) -> None:
    """Merge keys into job.payload and commit."""
    cur = job.payload or {}
    if not isinstance(cur, dict):
        cur = {}
    cur.update(patch or {})
    job.payload = cur
    job.updated_at = datetime.utcnow()
    db.add(job)
    db.commit()


def _tail_csv_rows(csv_path: Path, limit: int = 20) -> tuple[list[str], list[list[str]]]:
    """Return (columns, last_rows) from a csv file. Robust to partial writes."""
    try:
        if not csv_path.exists():
            return [], []
        lines = csv_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        lines = [ln for ln in lines if ln.strip()]
        if len(lines) < 2:
            return [], []
        header = lines[0]
        cols = [c.strip() for c in header.split(",") if c.strip()]
        data_lines = lines[1:][-max(1, int(limit)):]
        rows: list[list[str]] = []
        for ln in data_lines:
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) < len(cols):
                parts = parts + [""] * (len(cols) - len(parts))
            if len(parts) > len(cols):
                parts = parts[: len(cols)]
            rows.append(parts)
        return cols, rows
    except Exception:
        return [], []


def _format_train_live_message(cols: list[str], row: list[str], epochs_total: int) -> str:
    """Create a short UI-friendly message from a results.csv row."""
    try:
        col_to_val = {c: row[i] if i < len(row) else "" for i, c in enumerate(cols)}
        ep = None
        if "epoch" in col_to_val and str(col_to_val.get("epoch") or "").strip() != "":
            try:
                ep = int(float(col_to_val["epoch"])) + 1  # results.csv uses 0-indexed epoch
            except Exception:
                ep = None

        pick: list[tuple[str, str]] = []
        for k in [
            "train/box_loss",
            "train/cls_loss",
            "train/dfl_loss",
            "metrics/precision(B)",
            "metrics/recall(B)",
            "metrics/mAP50(B)",
            "metrics/mAP50-95(B)",
            "val/box_loss",
            "val/cls_loss",
            "val/dfl_loss",
        ]:
            v = str(col_to_val.get(k) or "").strip()
            if v:
                pick.append((k, v))

        if not pick:
            for k in cols:
                if k == "epoch":
                    continue
                v = str(col_to_val.get(k) or "").strip()
                if not v:
                    continue
                pick.append((k, v))
                if len(pick) >= 6:
                    break

        head = f"epoch {ep}/{epochs_total}" if ep is not None and epochs_total else "training…"
        tail = " | ".join([f"{k.split('/')[-1]}={v}" for (k, v) in pick[:6]])
        return f"{head}{(' | ' + tail) if tail else ''}"
    except Exception:
        return "training…"


def _sha16(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def _safe_posix(p: Path) -> str:
    return str(p).replace("\\", "/")


# ---------------------------------------------------------------------
# Train YOLO task
# ---------------------------------------------------------------------

@celery.task(name="train_yolo_task")
def train_yolo_task(job_id: int):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return

        payload = job.payload or {}
        _update_job(db, job, status="running", progress=0.01, message="initializing")

        # Required inputs
        dataset_id = int(payload.get("dataset_id", 0))
        annotation_set_id = int(payload.get("annotation_set_id", 0))
        base_model_id = int(payload.get("base_model_id", 0))
        trained_model_name = str(payload.get("trained_model_name", "trained_model")).strip() or "trained_model"

        if dataset_id <= 0 or annotation_set_id <= 0 or base_model_id <= 0:
            raise ValueError("dataset_id, annotation_set_id, base_model_id are required")

        dataset = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.project_id == job.project_id).first()
        aset = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id, AnnotationSet.project_id == job.project_id).first()
        base_mw = db.query(ModelWeight).filter(ModelWeight.id == base_model_id, ModelWeight.project_id == job.project_id).first()

        if not dataset:
            raise ValueError("dataset not found")
        if not aset:
            raise ValueError("annotation set not found")
        if not base_mw:
            raise ValueError("base model not found")

        # Config
        split_mode = str(payload.get("split_mode", "keep"))
        train_ratio = float(payload.get("train_ratio", 0.8))
        val_ratio = float(payload.get("val_ratio", 0.1))
        test_ratio = float(payload.get("test_ratio", 0.1))
        seed = int(payload.get("seed", 1337))

        imgsz = int(payload.get("imgsz", 640))
        epochs = int(payload.get("epochs", 50))
        batch = int(payload.get("batch", 16))
        device = str(payload.get("device", "0"))
        workers = int(payload.get("workers", 4))
        optimizer = str(payload.get("optimizer", "SGD"))

        # Allow env override (useful in Docker without changing DB payloads)
        env_workers = os.environ.get("YOLO_WORKERS", "").strip()
        if env_workers:
            try:
                workers = int(env_workers)
            except Exception:
                pass

        # Clamp to a sane range (avoids accidental huge worker counts)
        try:
            max_workers = int(os.environ.get("YOLO_WORKERS_MAX", "8"))
        except Exception:
            max_workers = 8
        workers = max(0, min(int(workers), max_workers))

        # Stability guard: default to forcing dataloader workers=0 in container setups
        if os.environ.get("ESSI_FORCE_DATALOADER_WORKERS0", "1") == "1":
            workers = 0

        approved_only = bool(payload.get("approved_only", True))

        bench_split = str(payload.get("bench_split", "test"))
        conf = float(payload.get("conf", 0.25))
        iou = float(payload.get("iou", 0.7))

        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}

        # Paths
        base_dir = Path(settings.storage_dir) / "trainings" / f"job_{job.id}"
        export_dir = base_dir / "exported_dataset"
        runs_dir = base_dir / "runs"
        artifacts_dir = base_dir / "artifacts"
        export_dir.mkdir(parents=True, exist_ok=True)
        runs_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        # Build dataset YOLO structure from annotations
        _update_job(db, job, progress=0.05, message="preparing dataset")

        # (Your existing dataset export logic continues here unchanged...)
        # NOTE: I kept the structure and only added live reporting + endpoints support.
        # -------------------------------------------------------------------------
        # BEGIN (existing logic from your file)
        # -------------------------------------------------------------------------

        # Collect label classes
        classes = db.query(LabelClass).filter(LabelClass.project_id == job.project_id).order_by(LabelClass.order_index.asc()).all()
        if not classes:
            raise ValueError("no label classes found")

        class_id_to_idx = {c.id: i for i, c in enumerate(classes)}
        class_names = [c.name for c in classes]

        # Gather items
        items_q = db.query(DatasetItem).filter(DatasetItem.dataset_id == dataset.id)
        items = items_q.all()

        if not items:
            raise ValueError("dataset has no items")

        # Split lists
        rng = random.Random(seed)
        if split_mode == "random":
            rng.shuffle(items)
            n = len(items)
            n_train = int(round(train_ratio * n))
            n_val = int(round(val_ratio * n))
            train_items = items[:n_train]
            val_items = items[n_train:n_train + n_val]
            test_items = items[n_train + n_val:]
        else:
            # keep dataset_item.split if present
            train_items = [it for it in items if (it.split or "train") == "train"]
            val_items = [it for it in items if (it.split or "train") == "val"]
            test_items = [it for it in items if (it.split or "train") == "test"]
            if not train_items:
                train_items = items

        splits = [("train", train_items), ("val", val_items), ("test", test_items)]

        # Create folder structure
        for sp, _ in splits:
            (export_dir / "images" / sp).mkdir(parents=True, exist_ok=True)
            (export_dir / "labels" / sp).mkdir(parents=True, exist_ok=True)

        # Export images + labels
        total = sum(len(x[1]) for x in splits) or 1
        done = 0

        for sp, its in splits:
            for it in its:
                done += 1
                if done % 25 == 0:
                    _update_job(db, job, progress=0.05 + (done / total) * 0.15, message=f"exporting dataset {done}/{total}")

                # Copy image file
                src = Path(settings.storage_dir) / it.rel_path
                dst = export_dir / "images" / sp / it.file_name
                if src.exists():
                    shutil.copy2(src, dst)

                # Labels for this item
                ann_q = db.query(Annotation).filter(
                    Annotation.dataset_item_id == it.id,
                    Annotation.annotation_set_id == aset.id,
                )
                if approved_only:
                    ann_q = ann_q.filter(Annotation.approved == True)  # noqa: E712
                anns = ann_q.all()

                label_lines = []
                for a in anns:
                    if a.class_id not in class_id_to_idx:
                        continue
                    cls_idx = class_id_to_idx[a.class_id]
                    # YOLO expects normalized center x,y,w,h
                    xc = (a.x + a.w / 2.0) / float(it.width)
                    yc = (a.y + a.h / 2.0) / float(it.height)
                    w = a.w / float(it.width)
                    h = a.h / float(it.height)
                    label_lines.append(f"{cls_idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

                label_path = export_dir / "labels" / sp / (Path(it.file_name).stem + ".txt")
                label_path.write_text("\n".join(label_lines), encoding="utf-8")

        # Write data.yaml
        yaml_path = export_dir / "data.yaml"
        yaml_path.write_text(
            "\n".join(
                [
                    f"path: {_safe_posix(export_dir)}",
                    "train: images/train",
                    "val: images/val",
                    "test: images/test",
                    f"nc: {len(class_names)}",
                    f"names: {json.dumps(class_names)}",
                ]
            ),
            encoding="utf-8",
        )

        # Base weights path
        base_weights_path = Path(settings.storage_dir) / base_mw.rel_path
        if not base_weights_path.exists():
            raise ValueError("base weights file missing on disk")

        # --------------------------
        # Model metadata check (BASE)
        # --------------------------
        proj = db.query(Project).filter(Project.id == job.project_id).first()
        expected_task = (proj.task_type if proj else None)
        _update_job(db, job, progress=0.215, message="checking base model metadata")
        base_check = check_model_metadata(
            base_weights_path,
            framework=base_mw.framework,
            expected_task=expected_task,
            expected_class_names=class_names,
            strict_class_order=True,
        )
        _merge_job_payload(db, job, {"base_model_check": base_check})
        if not base_check.get("ok"):
            raise ValueError(f"Base model incompatible: {base_check.get('summary') or base_check.get('error') or 'unknown'}")

        # -------------------------------------------------------------------------
        # END (existing logic)
        # -------------------------------------------------------------------------

        # Train
        run_name = f"train_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{_sha16(trained_model_name)}"
        _update_job(db, job, progress=0.22, message=f"training started ({run_name})")

        # Persist run metadata early so the UI can fetch live results.csv while training is running.
        run_dir = runs_dir / run_name
        try:
            _merge_job_payload(db, job, {
                "_train_run_name": run_name,
                "_train_base_rel": _safe_posix(base_dir.relative_to(Path(settings.storage_dir))),
                "_train_run_rel": _safe_posix(run_dir.relative_to(Path(settings.storage_dir))),
                "_train_epochs": epochs,
            })
        except Exception:
            pass

        # Live watcher: tails Ultralytics results.csv and updates job.message/progress so users
        # can see that training is actively progressing (no "stuck" feeling).
        stop_event = threading.Event()

        def _watch_results_csv():
            last_sig: str | None = None
            while not stop_event.is_set():
                try:
                    csv_path = run_dir / "results.csv"
                    cols, rows = _tail_csv_rows(csv_path, limit=1)
                    if rows:
                        row = rows[-1]
                        sig = "|".join(row)
                        if sig != last_sig:
                            last_sig = sig

                            prog = None
                            try:
                                if "epoch" in cols:
                                    ep_idx = cols.index("epoch")
                                    ep = int(float(row[ep_idx])) + 1
                                    frac = min(max(ep / max(1, epochs), 0.0), 1.0)
                                    prog = 0.22 + (frac * 0.56)
                            except Exception:
                                prog = None

                            msg = _format_train_live_message(cols, row, epochs)

                            db2 = SessionLocal()
                            try:
                                j2 = db2.query(Job).filter(Job.id == job_id).first()
                                if j2:
                                    _update_job(db2, j2, progress=prog, message=msg)
                            finally:
                                db2.close()
                except Exception:
                    pass

                stop_event.wait(2.0)

        watcher_thread = threading.Thread(target=_watch_results_csv, daemon=True)
        watcher_thread.start()

        model = YOLO(str(base_weights_path))

        if device.lower() in ("cpu", "mps"):
            device_arg = device.lower()
        else:
            device_arg = device

        # Train model (Ultralytics writes results.csv under runs_dir/run_name/)
        model.train(
            data=str(yaml_path),
            project=str(runs_dir),
            name=run_name,
            imgsz=imgsz,
            epochs=epochs,
            batch=batch,
            device=device_arg,
            workers=workers,
            optimizer=optimizer,
            patience=int(payload.get("patience", 20)),
            cos_lr=bool(payload.get("cos_lr", True)),
            cache=str(payload.get("cache", "disk")),
            amp=True,
            exist_ok=True,
        )

        # Stop live watcher cleanly now that training is finished.
        try:
            stop_event.set()
            watcher_thread.join(timeout=2.0)
        except Exception:
            pass

        _update_job(db, job, progress=0.78, message="training finished, collecting artifacts")

        # Save the trained weights as a ModelWeight in DB, and copy artifacts
        # (Your existing artifact logic continues here unchanged...)
        # -------------------------------------------------------------------------
        # BEGIN (existing logic from your file)
        # -------------------------------------------------------------------------

        # Locate best.pt (Ultralytics uses weights/best.pt)
        trained_dir = runs_dir / run_name
        best_pt = trained_dir / "weights" / "best.pt"
        last_pt = trained_dir / "weights" / "last.pt"
        if not best_pt.exists() and last_pt.exists():
            best_pt = last_pt
        if not best_pt.exists():
            raise ValueError("training finished but weights not found")

        # Copy model to artifacts dir
        model_out = artifacts_dir / "model.pt"
        shutil.copy2(best_pt, model_out)

        # -----------------------------
        # Model metadata check (TRAINED)
        # -----------------------------
        _update_job(db, job, progress=0.805, message="checking trained model metadata")
        proj = db.query(Project).filter(Project.id == job.project_id).first()
        expected_task = (proj.task_type if proj else None)
        trained_check = check_model_metadata(
            model_out,
            framework=base_mw.framework,
            expected_task=expected_task,
            expected_class_names=class_names,
            strict_class_order=True,
        )
        _merge_job_payload(db, job, {"trained_model_check": trained_check})
        if not trained_check.get("ok"):
            raise ValueError(f"Trained model incompatible: {trained_check.get('summary') or trained_check.get('error') or 'unknown'}")

        # Bench (val) on test/val split
        _update_job(db, job, progress=0.82, message=f"benchmarking on {bench_split} split")
        metrics_obj = YOLO(str(model_out)).val(
            data=str(yaml_path),
            split=bench_split,
            imgsz=imgsz,
            batch=batch,
            workers=workers,
            device=device_arg,
            conf=conf,
            iou=iou,
            project=str(artifacts_dir / "bench_runs"),
            name=f"val_{bench_split}",
            save_json=True,
            plots=True,
            exist_ok=True,
        )

        # Extract key metrics
        prec = float(getattr(getattr(metrics_obj, "box", None), "mp", 0.0) or 0.0)
        rec = float(getattr(getattr(metrics_obj, "box", None), "mr", 0.0) or 0.0)
        map50 = float(getattr(getattr(metrics_obj, "box", None), "map50", 0.0) or 0.0)
        map5095 = float(getattr(getattr(metrics_obj, "box", None), "map", 0.0) or 0.0)

        report_docx = artifacts_dir / "benchmark_report.docx"
        report_md = artifacts_dir / "benchmark_report.md"
        if not report_docx.exists():
            report_docx.write_text(
                f"Precision: {prec}\nRecall: {rec}\nmAP50: {map50}\nmAP50-95: {map5095}\n",
                encoding="utf-8",
            )
        if not report_md.exists():
            report_md.write_text(
                f"# Benchmark\n\n- precision(B): {prec}\n- recall(B): {rec}\n- mAP50(B): {map50}\n- mAP50-95(B): {map5095}\n",
                encoding="utf-8",
            )

        rel_report_path = str(report_docx.relative_to(Path(settings.storage_dir))).replace("\\", "/")

        # Insert ModelWeight into DB
        rel_model_path = str(model_out.relative_to(Path(settings.storage_dir))).replace("\\", "/")
        trained_class_names = {str(i): str(n) for i, n in enumerate(class_names)}
        mw = ModelWeight(
            project_id=job.project_id,
            name=trained_model_name,
            framework=base_mw.framework,
            rel_path=rel_model_path,
            class_names=trained_class_names,
            meta={
                **(base_mw.meta or {}),
                **(meta or {}),
                "trained_at": datetime.utcnow().isoformat(),
                "benchmark_report_rel_path": rel_report_path,
                "check": trained_check,
                "bench": {
                    "precision(B)": prec,
                    "recall(B)": rec,
                    "mAP50(B)": map50,
                    "mAP50-95(B)": map5095,
                    "split": bench_split,
                },
            },
        )
        db.add(mw)
        db.commit()
        db.refresh(mw)

        # -------------------------------------------------------------------------
        # END (existing logic)
        # -------------------------------------------------------------------------

        # Persist useful paths for the UI (results, plots, downloads).
        results_csv_rel_path = None
        try:
            results_csv = (runs_dir / run_name / "results.csv")
            if results_csv.exists():
                results_csv_rel_path = str(results_csv.relative_to(Path(settings.storage_dir))).replace("\\", "/")
        except Exception:
            results_csv_rel_path = None

        job.payload = {
            **payload,
            "trained_model_id": mw.id,
            "benchmark_report_rel_path": rel_report_path,
            "trained_model_name": trained_model_name,
            "_train_run_name": run_name,
            "_train_base_rel": str(base_dir.relative_to(Path(settings.storage_dir))).replace("\\", "/"),
            "_train_run_rel": str((runs_dir / run_name).relative_to(Path(settings.storage_dir))).replace("\\", "/"),
            "results_csv_rel_path": results_csv_rel_path,
            "bench_metrics": {
                "precision(B)": prec,
                "recall(B)": rec,
                "mAP50(B)": map50,
                "mAP50-95(B)": map5095,
                "bench_split": bench_split,
            },
        }
        db.add(job)
        _update_job(db, job, status="success", progress=1.0, message="done")

    except Exception as e:
        # Ensure watcher is stopped if training errors out mid-run.
        try:
            stop_event.set()
            watcher_thread.join(timeout=2.0)
        except Exception:
            pass
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                _update_job(db, job, status="failed", message=str(e))
        except Exception:
            pass
    finally:
        db.close()
