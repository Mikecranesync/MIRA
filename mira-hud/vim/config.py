"""VIM configuration dataclasses.

All tunable parameters in one place. No logic. Pure dataclasses.
Every other VIM module imports from here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

# ---------------------------------------------------------------------------
# Base paths — derived from this file's location
# ---------------------------------------------------------------------------
_VIM_DIR = Path(__file__).resolve().parent
_HUD_DIR = _VIM_DIR.parent
_DATA_DIR = _HUD_DIR / "data"
_MODELS_DIR = _HUD_DIR / "models"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class SessionState(str, Enum):
    """VIM session lifecycle states."""

    IDLE = "IDLE"
    SCANNING = "SCANNING"
    MANIFEST_READY = "MANIFEST_READY"
    COMPONENT_SELECTED = "COMPONENT_SELECTED"
    PROCEDURE_ACTIVE = "PROCEDURE_ACTIVE"


class CameraSourceType(str, Enum):
    """Supported camera source backends."""

    WEBCAM = "webcam"
    RTSP = "rtsp"
    FILE = "file"
    API = "api"


class OverlayMode(str, Enum):
    """AR overlay display modes."""

    SCANNING = "SCANNING"
    FOCUSED = "FOCUSED"
    PROCEDURE = "PROCEDURE"


# ---------------------------------------------------------------------------
# Scanner — OpenCV geometric detector (Layer 1, CPU-only)
# ---------------------------------------------------------------------------
@dataclass
class ScannerConfig:
    """OpenCV findContours + HoughLinesP parameters."""

    # Canny edge detection
    canny_low: int = 50
    canny_high: int = 150

    # Rectangle filtering
    min_rect_area: int = 2000  # px² — ignore tiny noise
    max_rect_area: int = 500_000  # px² — ignore full-frame edges
    aspect_ratio_min: float = 0.2  # filter extreme slivers
    aspect_ratio_max: float = 5.0  # filter extreme banners

    # Hough line detection
    line_min_length: int = 80  # px — minimum wire/hose segment
    line_max_gap: int = 20  # px — gap tolerance
    hough_threshold: int = 50  # accumulator threshold

    # Gaussian blur kernel (must be odd)
    blur_kernel: int = 5

    # Contour approximation epsilon multiplier (fraction of perimeter)
    approx_epsilon: float = 0.02


# ---------------------------------------------------------------------------
# Classifier — YOLOv8 semantic classifier (Layer 2, GPU on crops)
# ---------------------------------------------------------------------------
@dataclass
class ClassifierConfig:
    """YOLOv8n parameters for cropped patch classification."""

    # Model paths (checked in order: custom → pretrained fallback)
    custom_model_path: Path = field(default_factory=lambda: _MODELS_DIR / "factorylm_vim.pt")
    fallback_model: str = "yolov8n.pt"

    # Inference
    confidence_threshold: float = 0.65
    batch_size: int = 16
    device: str = ""  # "" = auto-detect (cuda/mps/cpu)

    # Crop padding (fraction of bounding box added on each side)
    crop_padding: float = 0.1

    # Phase 1 detection classes (industrial)
    industrial_classes: list[str] = field(
        default_factory=lambda: [
            "relay",
            "contactor",
            "circuit_breaker",
            "terminal_block",
            "vfd",
            "transformer",
            "plc_module",
            "junction_box",
            "sensor_housing",
            "connector_block",
            "wire_harness",
            "conduit",
            "hydraulic_hose",
            "pneumatic_line",
            "cable_tray",
            "flexible_tubing",
        ]
    )

    # Phase 2 detection classes (aircraft-specific, added later)
    aircraft_classes: list[str] = field(
        default_factory=lambda: [
            "fuel_line",
            "bleed_air_duct",
            "hydraulic_actuator",
            "rotor_component",
            "avionics_box",
            "quick_disconnect",
            "bonding_strap",
            "p_clamp",
        ]
    )


# ---------------------------------------------------------------------------
# Session — Technician session state machine
# ---------------------------------------------------------------------------
@dataclass
class SessionConfig:
    """Session manager parameters."""

    # IoU deduplication threshold — two detections with IoU > this
    # AND matching class_name are considered the same component
    iou_threshold: float = 0.7

    # Components absent from frame longer than this are marked stale
    stale_timeout_s: float = 15.0

    # Maximum active (non-stale) items displayed in HUD
    max_manifest_items: int = 8

    # Frame history buffer size for deduplication
    frame_history_size: int = 10


# ---------------------------------------------------------------------------
# Parser — Technical Manual PDF ingestion
# ---------------------------------------------------------------------------
@dataclass
class ParserConfig:
    """TM PDF parser parameters."""

    # Image extraction DPI (PyMuPDF)
    image_dpi: int = 150

    # Minimum image dimensions to keep (skip tiny icons)
    min_image_width: int = 100  # px
    min_image_height: int = 100  # px

    # Adjacent text radius for auto-labeling extracted images
    adjacent_text_radius: int = 200  # px

    # Text chunking (for text-only blocks)
    chunk_size: int = 800  # chars
    chunk_overlap: int = 100  # chars

    # Output paths
    tm_pdfs_dir: Path = field(default_factory=lambda: _DATA_DIR / "tm_pdfs")
    tm_images_dir: Path = field(default_factory=lambda: _DATA_DIR / "tm_images")
    tm_manifests_dir: Path = field(default_factory=lambda: _DATA_DIR / "tm_manifests")

    # Distribution statement filter — only process "A" (public domain)
    allowed_distribution: str = "A"


# ---------------------------------------------------------------------------
# DB — Vector DB adapter for multimodal chunks
# ---------------------------------------------------------------------------
@dataclass
class DBConfig:
    """NeonDB / vector DB connection parameters."""

    # Connection (from env, never hardcoded)
    database_url: str = field(default_factory=lambda: os.getenv("NEON_DATABASE_URL", ""))
    tenant_id: str = field(default_factory=lambda: os.getenv("MIRA_TENANT_ID", ""))

    # Embedding model (via Ollama)
    ollama_base_url: str = field(
        default_factory=lambda: os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    )
    text_embed_model: str = "nomic-embed-text:v1.5"
    image_embed_model: str = "nomic-embed-vision:v1.5"

    # Retrieval
    top_k: int = 5

    # Collection name for TM chunks
    collection_name: str = "vim_technical_manuals"


# ---------------------------------------------------------------------------
# Orchestrator — Scan loop coordinator
# ---------------------------------------------------------------------------
@dataclass
class OrchestratorConfig:
    """Scan loop and camera source parameters."""

    # Scan cadence
    scan_interval_s: float = 3.0

    # Camera source
    source_type: CameraSourceType = CameraSourceType.FILE
    camera_device_index: int = 0  # for webcam
    rtsp_url: str = ""  # for rtsp source
    video_file_path: str = ""  # for file source

    # Frame buffer
    frame_buffer_size: int = 5

    # Socket.IO connection (VIM → server.js)
    socketio_url: str = "http://localhost:3000"


# ---------------------------------------------------------------------------
# Convenience: all configs in one bundle
# ---------------------------------------------------------------------------
@dataclass
class VIMConfig:
    """Top-level container for all VIM configuration."""

    scanner: ScannerConfig = field(default_factory=ScannerConfig)
    classifier: ClassifierConfig = field(default_factory=ClassifierConfig)
    session: SessionConfig = field(default_factory=SessionConfig)
    parser: ParserConfig = field(default_factory=ParserConfig)
    db: DBConfig = field(default_factory=DBConfig)
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
