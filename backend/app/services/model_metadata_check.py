from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.services.inference import load_ultralytics_model, get_model_class_names


_TASK_ALIASES = {
    "detection": "detect",
    "detect": "detect",
    "segmentation": "segment",
    "segment": "segment",
    "classification": "classify",
    "classify": "classify",
    "pose": "pose",
    "obb": "obb",
}


def _norm_task(t: Any) -> Optional[str]:
    if not t:
        return None
    s = str(t).strip().lower()
    return _TASK_ALIASES.get(s, s)


def _ordered_name_list(names_map: Dict[str, str]) -> List[str]:
    # keys are usually "0","1",... but may be ints serialized to str
    items: List[Tuple[int, str]] = []
    for k, v in (names_map or {}).items():
        try:
            ik = int(str(k))
        except Exception:
            continue
        items.append((ik, str(v)))
    items.sort(key=lambda x: x[0])
    # fill gaps only if needed; usually continuous
    return [v for _, v in items]


def _diff_classes(expected: List[str], actual: List[str]) -> Dict[str, Any]:
    exp = [str(x) for x in (expected or [])]
    act = [str(x) for x in (actual or [])]

    missing = [x for x in exp if x not in act]
    extra = [x for x in act if x not in exp]

    order_mismatches: List[Dict[str, Any]] = []
    n = min(len(exp), len(act))
    for i in range(n):
        if exp[i] != act[i]:
            order_mismatches.append({"index": i, "expected": exp[i], "actual": act[i]})

    return {
        "expected_nc": len(exp),
        "actual_nc": len(act),
        "missing_expected": missing,
        "extra_actual": extra,
        "order_mismatches": order_mismatches,
    }


def check_model_metadata(
    weights_path: Path,
    framework: str = "ultralytics",
    *,
    expected_task: Optional[str] = None,
    expected_class_names: Optional[List[str]] = None,
    strict_class_order: bool = True,
) -> Dict[str, Any]:
    """
    Returns a JSON-serializable dict:
      ok, framework, task/task_ok, class_ok, diffs, warnings/errors, timestamps, etc.
    """
    weights_path = Path(weights_path)
    fw = (framework or "").strip().lower()

    out: Dict[str, Any] = {
        "ok": False,
        "checked_at": datetime.utcnow().isoformat(),
        "framework": fw or "unknown",
        "path": str(weights_path).replace("\\", "/"),
        "expected_task": _norm_task(expected_task),
        "expected_classes": list(expected_class_names) if expected_class_names else None,
        "task": None,
        "task_ok": None,
        "class_names": None,
        "class_ok": None,
        "diff": None,
        "warnings": [],
        "error": None,
        "summary": None,
    }

    if not weights_path.exists() or not weights_path.is_file():
        out["error"] = "weights file not found"
        out["summary"] = "Missing weights file on disk."
        return out

    # Only enforce for Ultralytics .pt (your stack uses this for training)
    if fw not in ("ultralytics", "yolo", "pt"):
        out["warnings"].append(f"metadata check is limited; unsupported framework '{fw}'")
        out["ok"] = True  # treat as non-blocking
        out["summary"] = f"Framework '{fw}' not fully supported for deep metadata check."
        return out

    try:
        model = load_ultralytics_model(weights_path)
        actual_task = _norm_task(getattr(model, "task", None))
        names_map = get_model_class_names(model)
        actual_names = _ordered_name_list(names_map)

        out["task"] = actual_task
        out["class_names"] = actual_names

        # task check
        if out["expected_task"]:
            out["task_ok"] = (actual_task == out["expected_task"])
        else:
            out["task_ok"] = None

        # class check
        if expected_class_names is not None:
            diff = _diff_classes(expected_class_names, actual_names)
            out["diff"] = diff

            if strict_class_order:
                out["class_ok"] = (
                    diff["expected_nc"] == diff["actual_nc"]
                    and len(diff["missing_expected"]) == 0
                    and len(diff["extra_actual"]) == 0
                    and len(diff["order_mismatches"]) == 0
                )
            else:
                out["class_ok"] = (
                    diff["expected_nc"] == diff["actual_nc"]
                    and len(diff["missing_expected"]) == 0
                    and len(diff["extra_actual"]) == 0
                )
        else:
            out["class_ok"] = None

        # overall ok
        task_ok = True if out["task_ok"] is None else bool(out["task_ok"])
        class_ok = True if out["class_ok"] is None else bool(out["class_ok"])
        out["ok"] = bool(task_ok and class_ok)

        if out["ok"]:
            out["summary"] = "Model metadata looks compatible."
        else:
            parts = []
            if out["task_ok"] is False:
                parts.append(f"task mismatch (expected {out['expected_task']} got {actual_task})")
            if out["class_ok"] is False and isinstance(out["diff"], dict):
                d = out["diff"]
                parts.append(f"class mismatch (expected {d.get('expected_nc')} got {d.get('actual_nc')})")
            out["summary"] = "; ".join(parts) if parts else "Model metadata mismatch."

        return out

    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        out["summary"] = "Failed to load model for metadata check."
        return out
