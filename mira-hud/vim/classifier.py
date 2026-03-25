"""YOLOv8 semantic classifier (Layer 2, GPU on crops).

Takes cropped image patches from the Layer 1 scanner and classifies them
into industrial component categories. Uses YOLOv8n for inference with
model loading priority: custom factorylm_vim.pt -> pretrained yolov8n.pt.

When using the pretrained COCO model, detected COCO classes are mapped to
industrial categories where applicable (e.g., COCO "tv" -> "vfd",
"refrigerator" -> "junction_box"). This mapping is a temporary bridge
until Phase 6 custom training produces a purpose-built model.

Usage:
    from vim.classifier import classify_crops, load_model
    from vim.config import ClassifierConfig

    model = load_model(ClassifierConfig())
    results = classify_crops(model, crops, ClassifierConfig())
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np

from .config import ClassifierConfig
from .scene_scanner import BoundingBox

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("vim-classifier")


# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Classification:
    """Classification result for a single cropped region."""

    class_name: str
    confidence: float
    bbox: BoundingBox
    yolo_class_id: int = -1
    yolo_class_name: str = ""


@dataclass(frozen=True)
class ClassificationBatch:
    """Batch classification results."""

    classifications: list[Classification]
    processing_time_ms: float
    model_name: str
    device: str


# ---------------------------------------------------------------------------
# COCO → Industrial class mapping (pretrained fallback)
# ---------------------------------------------------------------------------

# When using pretrained YOLOv8n (COCO 80 classes), map relevant detections
# to our industrial taxonomy. This is a rough bridge until custom training.
_COCO_TO_INDUSTRIAL: dict[str, str] = {
    # Electronics / displays → industrial control equipment
    "tv": "vfd",
    "monitor": "vfd",
    "laptop": "plc_module",
    "cell phone": "sensor_housing",
    "remote": "connector_block",
    # Appliances → enclosures
    "refrigerator": "junction_box",
    "oven": "transformer",
    "microwave": "circuit_breaker",
    "toaster": "relay",
    # Infrastructure
    "fire hydrant": "junction_box",
    "parking meter": "sensor_housing",
    "bench": "cable_tray",
    # Containers
    "suitcase": "junction_box",
    "backpack": "junction_box",
    "handbag": "connector_block",
    # Books/paper → control panels with labels
    "book": "terminal_block",
}

# Inverse: all known industrial class names for validation
_ALL_INDUSTRIAL = set()


def _init_industrial_classes() -> None:
    global _ALL_INDUSTRIAL  # noqa: PLW0603
    config = ClassifierConfig()
    _ALL_INDUSTRIAL = set(config.industrial_classes + config.aircraft_classes)


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def load_model(config: ClassifierConfig | None = None):
    """Load YOLO model with priority: custom -> pretrained fallback.

    Returns the ultralytics YOLO model instance.
    """
    from ultralytics import YOLO

    if config is None:
        config = ClassifierConfig()

    # Try custom model first
    if config.custom_model_path.exists():
        logger.info("Loading custom model: %s", config.custom_model_path)
        model = YOLO(str(config.custom_model_path))
        logger.info("Custom model loaded (%d classes)", len(model.names))
        return model

    # Fall back to pretrained
    logger.info(
        "Custom model not found at %s — using pretrained %s",
        config.custom_model_path,
        config.fallback_model,
    )
    model = YOLO(config.fallback_model)
    logger.info("Pretrained model loaded (%d classes: COCO)", len(model.names))
    return model


def get_model_info(model) -> dict:
    """Return model metadata."""
    return {
        "name": getattr(model, "model_name", str(model.ckpt_path))
        if hasattr(model, "ckpt_path")
        else "unknown",
        "num_classes": len(model.names) if hasattr(model, "names") else 0,
        "class_names": dict(model.names) if hasattr(model, "names") else {},
        "is_custom": not str(getattr(model, "ckpt_path", "")).endswith("yolov8n.pt"),
    }


# ---------------------------------------------------------------------------
# Crop extraction
# ---------------------------------------------------------------------------


def extract_crop(
    frame: np.ndarray,
    bbox: BoundingBox,
    padding: float = 0.1,
) -> np.ndarray:
    """Extract a padded crop from the frame around a bounding box.

    Args:
        frame: Full BGR frame (HxWx3).
        bbox: BoundingBox from scanner.
        padding: Fraction of bbox dimensions to add on each side.

    Returns:
        Cropped BGR image (numpy array).
    """
    h_frame, w_frame = frame.shape[:2]

    pad_w = int(bbox.w * padding)
    pad_h = int(bbox.h * padding)

    x1 = max(0, bbox.x - pad_w)
    y1 = max(0, bbox.y - pad_h)
    x2 = min(w_frame, bbox.x + bbox.w + pad_w)
    y2 = min(h_frame, bbox.y + bbox.h + pad_h)

    return frame[y1:y2, x1:x2].copy()


def extract_crops(
    frame: np.ndarray,
    bboxes: list[BoundingBox],
    padding: float = 0.1,
) -> list[np.ndarray]:
    """Extract padded crops for a list of bounding boxes."""
    return [extract_crop(frame, bb, padding) for bb in bboxes]


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def _map_class_name(yolo_class_name: str, is_custom_model: bool) -> str:
    """Map YOLO class name to industrial taxonomy.

    Custom models use industrial class names directly.
    Pretrained COCO models use the mapping table.
    """
    if is_custom_model:
        return yolo_class_name

    return _COCO_TO_INDUSTRIAL.get(yolo_class_name, yolo_class_name)


def classify_crop(
    model,
    crop: np.ndarray,
    config: ClassifierConfig | None = None,
) -> Classification | None:
    """Classify a single cropped image.

    Returns the top Classification above confidence threshold, or None.
    """
    if config is None:
        config = ClassifierConfig()

    device = config.device if config.device else None
    results = model.predict(
        crop,
        conf=config.confidence_threshold,
        device=device,
        verbose=False,
    )

    if not results or len(results) == 0:
        return None

    result = results[0]
    if result.boxes is None or len(result.boxes) == 0:
        return None

    # Take highest confidence detection
    boxes = result.boxes
    confs = boxes.conf.cpu().numpy()
    if len(confs) == 0:
        return None

    best_idx = int(confs.argmax())
    best_conf = float(confs[best_idx])
    best_cls_id = int(boxes.cls[best_idx].cpu().numpy())
    yolo_name = model.names.get(best_cls_id, f"class_{best_cls_id}")

    is_custom = not str(getattr(model, "ckpt_path", "")).endswith("yolov8n.pt")
    mapped_name = _map_class_name(yolo_name, is_custom)

    # Create a dummy bbox for standalone crop classification
    h, w = crop.shape[:2]
    bbox = BoundingBox(
        x=0, y=0, w=w, h=h, area=w * h, aspect_ratio=round(w / h, 3) if h > 0 else 0.0
    )

    return Classification(
        class_name=mapped_name,
        confidence=round(best_conf, 4),
        bbox=bbox,
        yolo_class_id=best_cls_id,
        yolo_class_name=yolo_name,
    )


def classify_crops(
    model,
    crops: list[np.ndarray],
    bboxes: list[BoundingBox] | None = None,
    config: ClassifierConfig | None = None,
) -> ClassificationBatch:
    """Classify a batch of cropped images.

    Args:
        model: Loaded YOLO model from load_model().
        crops: List of BGR crop images.
        bboxes: Optional original BoundingBoxes (for provenance tracking).
        config: Classifier parameters.

    Returns:
        ClassificationBatch with results above confidence threshold.
    """
    if config is None:
        config = ClassifierConfig()

    if not crops:
        return ClassificationBatch(
            classifications=[],
            processing_time_ms=0.0,
            model_name=str(getattr(model, "ckpt_path", "unknown")),
            device=config.device or "auto",
        )

    t_start = time.perf_counter()

    device = config.device if config.device else None

    # Run batch inference
    results_list = model.predict(
        crops,
        conf=config.confidence_threshold,
        device=device,
        verbose=False,
        batch=config.batch_size,
    )

    classifications: list[Classification] = []

    for i, result in enumerate(results_list):
        if result.boxes is None or len(result.boxes) == 0:
            continue

        boxes = result.boxes
        confs = boxes.conf.cpu().numpy()
        if len(confs) == 0:
            continue

        best_idx = int(confs.argmax())
        best_conf = float(confs[best_idx])
        best_cls_id = int(boxes.cls[best_idx].cpu().numpy())
        yolo_name = model.names.get(best_cls_id, f"class_{best_cls_id}")

        is_custom = not str(getattr(model, "ckpt_path", "")).endswith("yolov8n.pt")
        mapped_name = _map_class_name(yolo_name, is_custom)

        # Use original bbox if provided, otherwise construct from crop
        if bboxes and i < len(bboxes):
            bbox = bboxes[i]
        else:
            h, w = crops[i].shape[:2]
            bbox = BoundingBox(
                x=0,
                y=0,
                w=w,
                h=h,
                area=w * h,
                aspect_ratio=round(w / h, 3) if h > 0 else 0.0,
            )

        classifications.append(
            Classification(
                class_name=mapped_name,
                confidence=round(best_conf, 4),
                bbox=bbox,
                yolo_class_id=best_cls_id,
                yolo_class_name=yolo_name,
            )
        )

    elapsed_ms = (time.perf_counter() - t_start) * 1000.0

    return ClassificationBatch(
        classifications=classifications,
        processing_time_ms=round(elapsed_ms, 1),
        model_name=str(getattr(model, "ckpt_path", "unknown")),
        device=config.device or "auto",
    )


# ---------------------------------------------------------------------------
# Two-layer pipeline convenience
# ---------------------------------------------------------------------------


def scan_and_classify(
    frame: np.ndarray,
    model,
    scanner_config=None,
    classifier_config: ClassifierConfig | None = None,
) -> tuple:
    """Full two-layer pipeline: scan frame -> extract crops -> classify.

    Returns (ScanResult, ClassificationBatch).
    """
    from .config import ScannerConfig
    from .scene_scanner import scan_frame

    if scanner_config is None:
        scanner_config = ScannerConfig()
    if classifier_config is None:
        classifier_config = ClassifierConfig()

    # Layer 1: geometric scan (CPU)
    scan_result = scan_frame(frame, scanner_config)

    # Extract crops from detected rectangles
    crops = extract_crops(frame, scan_result.rectangles, classifier_config.crop_padding)

    # Layer 2: YOLO classification (GPU on crops)
    batch_result = classify_crops(model, crops, scan_result.rectangles, classifier_config)

    return scan_result, batch_result
