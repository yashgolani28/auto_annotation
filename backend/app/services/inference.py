from __future__ import annotations
from pathlib import Path
from typing import List, Dict, Any

def load_ultralytics_model(weights_path: Path):
    from ultralytics import YOLO
    return YOLO(str(weights_path))

def get_model_class_names(model) -> Dict[str, str]:
    names = getattr(model, "names", None)
    if isinstance(names, dict):
        return {str(k): str(v) for k, v in names.items()}
    if isinstance(names, list):
        return {str(i): str(v) for i, v in enumerate(names)}
    return {}

def predict_bboxes(model, image_path: Path, conf: float, iou: float, device: str = "") -> List[Dict[str, Any]]:
    preds = model.predict(source=str(image_path), conf=conf, iou=iou, device=(device or None), verbose=False)
    if not preds:
        return []
    r = preds[0]
    boxes = getattr(r, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return []
    out = []
    for b in boxes:
        cls_idx = int(b.cls.item())
        conf_v = float(b.conf.item()) if getattr(b, "conf", None) is not None else None
        xywh = b.xywh.cpu().numpy().reshape(-1).tolist()  # center xywh
        x_c, y_c, w, h = xywh
        x = float(x_c - w / 2.0)
        y = float(y_c - h / 2.0)
        out.append({"cls_idx": cls_idx, "conf": conf_v, "xywh": [x, y, float(w), float(h)]})
    return out
