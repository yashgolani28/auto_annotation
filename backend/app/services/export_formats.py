from __future__ import annotations
from pathlib import Path
from typing import List, Dict
import json
import shutil
import zipfile
from datetime import datetime

def _safe_mkdir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def yolo_export_bundle(
    workdir: Path,
    items: List[dict],
    classes: List[dict],
    annotations_by_item: Dict[int, List[dict]],
    include_images: bool,
) -> Path:
    _safe_mkdir(workdir)
    images_dir = workdir / "images"
    labels_dir = workdir / "labels"
    for split in ["train", "val", "test"]:
        _safe_mkdir(images_dir / split)
        _safe_mkdir(labels_dir / split)

    class_id_to_yolo = {c["id"]: i for i, c in enumerate(classes)}
    names = [c["name"] for c in classes]

    for it in items:
        split = it.get("split", "train")
        img_src = Path(it["abs_path"])
        img_dst = images_dir / split / img_src.name
        lbl_dst = labels_dir / split / (img_src.stem + ".txt")

        if include_images:
            shutil.copy2(img_src, img_dst)

        w_img = float(it["width"])
        h_img = float(it["height"])

        lines = []
        for a in annotations_by_item.get(it["id"], []):
            cid = a["class_id"]
            if cid not in class_id_to_yolo:
                continue
            x, y, w, h = float(a["x"]), float(a["y"]), float(a["w"]), float(a["h"])

            # clamp to image
            x = max(0.0, min(x, w_img - 1))
            y = max(0.0, min(y, h_img - 1))
            w = max(0.0, min(w, w_img - x))
            h = max(0.0, min(h, h_img - y))

            x_c = (x + w / 2.0) / w_img
            y_c = (y + h / 2.0) / h_img
            w_n = w / w_img
            h_n = h / h_img
            lines.append(f"{class_id_to_yolo[cid]} {x_c:.6f} {y_c:.6f} {w_n:.6f} {h_n:.6f}")

        lbl_dst.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    data_yaml = workdir / "data.yaml"
    yaml_lines = [
        "path: .",
        "train: images/train",
        "val: images/val",
        "test: images/test",
        f"names: {json.dumps(names, ensure_ascii=False)}",
        "",
    ]
    data_yaml.write_text("\n".join(yaml_lines), encoding="utf-8")

    zip_path = workdir.parent / f"export_yolo_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in workdir.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(workdir))
    return zip_path

def coco_export_bundle(
    workdir: Path,
    items: List[dict],
    classes: List[dict],
    annotations_by_item: Dict[int, List[dict]],
    include_images: bool,
) -> Path:
    _safe_mkdir(workdir)
    images_dir = workdir / "images"
    _safe_mkdir(images_dir)

    categories = [{"id": c["id"], "name": c["name"]} for c in classes]

    images = []
    annotations = []
    ann_id = 1

    for it in items:
        img_src = Path(it["abs_path"])
        if include_images:
            shutil.copy2(img_src, images_dir / img_src.name)

        images.append({
            "id": it["id"],
            "file_name": img_src.name,
            "width": it["width"],
            "height": it["height"],
        })

        for a in annotations_by_item.get(it["id"], []):
            x, y, w, h = float(a["x"]), float(a["y"]), float(a["w"]), float(a["h"])
            annotations.append({
                "id": ann_id,
                "image_id": it["id"],
                "category_id": int(a["class_id"]),
                "bbox": [x, y, w, h],
                "area": float(max(0.0, w) * max(0.0, h)),
                "iscrowd": 0,
            })
            ann_id += 1

    coco = {
        "info": {"description": "auto-annotator export", "version": "1.0"},
        "licenses": [],
        "images": images,
        "annotations": annotations,
        "categories": categories,
    }
    (workdir / "annotations.json").write_text(json.dumps(coco, indent=2, ensure_ascii=False), encoding="utf-8")

    zip_path = workdir.parent / f"export_coco_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in workdir.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(workdir))
    return zip_path
