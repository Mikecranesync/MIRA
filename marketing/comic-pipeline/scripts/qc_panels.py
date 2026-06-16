#!/usr/bin/env python3
"""
QC tool for AI-generated comic panels.

Three checks per panel, each catches a different failure class:

  Layer A — OCR + assertions (catches typos, missing strings).
    Uses OpenAI gpt-4o-mini vision to extract every visible string from
    the panel, then asserts presence of `required_strings` and absence of
    `forbidden_strings` from the storyboard's per-shot `qc:` block.

  Layer B — Vision-LLM rubric scoring (catches missing characters, mislabels).
    Same vision call returns three scores: character_match, style_match,
    prompt_adherence (1–10 each). Pass threshold ≥ 7 on all three.

  Layer C — Style consistency hash (catches palette/style drift).
    pHash distance vs a brand-anchor image (e.g., the v2 ChatGPT page
    serving the same role). Hamming distance > 18 = drift.

Usage:
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python scripts/qc_panels.py \\
          --storyboard scripts/storyboard_vfd_f004.yaml \\
          [--version v1]      # check the .v1.png copies instead of .png
          [--shots 3,4,5]     # restrict to specific shots

Output:
  - Rich table to stdout (per-panel pass/fail across all three layers)
  - JSON report to output/qc/<storyboard-stem>_<version>.json
  - Exit code 0 if all panels pass, 1 if any fail

Cost (5 panels): ~$0.10 in OpenAI vision calls.

Layer B falls back gracefully if a vision call fails — that panel scores 0
and gets flagged. Layer A is strict: missing required string OR present
forbidden string = FAIL.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import imagehash
import yaml
from openai import OpenAI
from PIL import Image
from rich.console import Console
from rich.table import Table

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

REF_DIR = PROJECT_ROOT / "reference"
OUTPUT_QC_DIR = PROJECT_ROOT / "output" / "qc"
DEFAULT_MODEL = "gpt-4o-mini"     # cheap, accurate, fast for OCR + scoring
STYLE_DRIFT_THRESHOLD = 18         # pHash Hamming distance — empirical

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("qc-panels")
console = Console()


# ─── result dataclasses ──────────────────────────────────────────────────────


@dataclass
class LayerAResult:
    """OCR + assertion outcome."""
    extracted_text: list[str] = field(default_factory=list)
    required_found: list[str] = field(default_factory=list)
    required_missing: list[str] = field(default_factory=list)
    forbidden_found: list[str] = field(default_factory=list)
    passed: bool = False


@dataclass
class LayerBResult:
    """Vision-LLM rubric outcome."""
    character_match: int = 0
    style_match: int = 0
    prompt_adherence: int = 0
    notes: str = ""
    passed: bool = False


@dataclass
class LayerCResult:
    """pHash style consistency outcome."""
    panel_hash: str = ""
    anchor_hash: str = ""
    distance: int = 0
    threshold: int = STYLE_DRIFT_THRESHOLD
    anchor_path: str = ""
    passed: bool = False


@dataclass
class PanelQC:
    shot_id: int
    panel_path: str
    role: str
    layer_a: LayerAResult
    layer_b: LayerBResult
    layer_c: LayerCResult

    @property
    def all_passed(self) -> bool:
        return self.layer_a.passed and self.layer_b.passed and self.layer_c.passed


# ─── Layer A + B: combined vision-LLM call ───────────────────────────────────


COMBINED_PROMPT = """\
You are reviewing an AI-generated comic-book panel from a marketing video.
Two tasks:

TASK 1 — OCR. Extract EVERY visible text element from the panel: signs,
captions, speech bubbles, screens, labels, button text, anything readable.
Include each element verbatim, with original case and any typos.

TASK 2 — Score on three axes (1–10, where 10 is excellent and ≤6 is failing):
  - character_match: do named characters in the panel match the supplied
    anchor reference (faces, proportions, outfits, hair)?
  - style_match: does the line work, color palette (dark steel blue + amber
    + high-contrast black with selective red/green accents), bold panel
    borders, gritty 1990s Vertigo comic aesthetic match the anchor?
  - prompt_adherence: does the panel actually contain what the prompt
    describes (specific signs, screens, layouts, named characters)?

Return ONLY this JSON object — no preamble, no code fences:
{
  "extracted_text": ["text1", "text2", ...],
  "character_match": <int>,
  "style_match": <int>,
  "prompt_adherence": <int>,
  "notes": "<one to three sentences flagging any concerns>"
}\
"""


def _b64_image(path: Path, *, max_dim: int = 768) -> str:
    """Resize image to ≤max_dim on the long edge, then base64-encode.

    Avoids OpenAI's per-minute token limit when sending two large 1536×1024
    PNGs per call. 768px is plenty for OCR + style scoring.
    """
    img = Image.open(path)
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def _parse_json_strict(raw: str) -> dict[str, Any]:
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON object found in: {raw[:300]}")
    return json.loads(m.group(0))


def run_vision_pass(
    client: OpenAI,
    *,
    panel_path: Path,
    anchor_path: Path | None,
    prompt_text: str,
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """One vision call returning OCR + 3-axis scores. Anchor optional."""
    panel_b64 = _b64_image(panel_path)
    content: list[dict[str, Any]] = [
        {"type": "text", "text": "PANEL TO REVIEW:"},
        {"type": "image_url",
         "image_url": {"url": f"data:image/png;base64,{panel_b64}"}},
    ]
    if anchor_path and anchor_path.exists():
        anchor_b64 = _b64_image(anchor_path)
        content.append({"type": "text", "text": "ANCHOR (style + character reference):"})
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{anchor_b64}"}})
    content.append({"type": "text", "text": f"PROMPT FOR THE PANEL:\n{prompt_text}"})
    content.append({"type": "text", "text": COMBINED_PROMPT})

    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        max_tokens=1200,
    )
    raw = response.choices[0].message.content or ""
    return _parse_json_strict(raw)


# ─── Layer A: assertion check on OCR output ──────────────────────────────────


def check_assertions(
    *,
    extracted_text: list[str],
    required: list[str],
    forbidden: list[str],
) -> LayerAResult:
    haystack = " ".join(extracted_text).lower()
    required_found: list[str] = []
    required_missing: list[str] = []
    for needle in required:
        if needle.lower() in haystack:
            required_found.append(needle)
        else:
            required_missing.append(needle)
    forbidden_found: list[str] = [f for f in forbidden if f.lower() in haystack]
    passed = not required_missing and not forbidden_found
    return LayerAResult(
        extracted_text=extracted_text,
        required_found=required_found,
        required_missing=required_missing,
        forbidden_found=forbidden_found,
        passed=passed,
    )


# ─── Layer C: pHash style consistency ────────────────────────────────────────


def check_style_hash(
    *,
    panel_path: Path,
    anchor_path: Path,
    threshold: int = STYLE_DRIFT_THRESHOLD,
) -> LayerCResult:
    panel_hash = imagehash.phash(Image.open(panel_path))
    anchor_hash = imagehash.phash(Image.open(anchor_path))
    distance = int(panel_hash - anchor_hash)  # coerce numpy → Python int up front
    return LayerCResult(
        panel_hash=str(panel_hash),
        anchor_hash=str(anchor_hash),
        distance=distance,
        threshold=threshold,
        anchor_path=str(anchor_path),
        passed=bool(distance <= threshold),
    )


# ─── orchestration ───────────────────────────────────────────────────────────


def qc_one_shot(
    client: OpenAI,
    *,
    shot: dict[str, Any],
    panel_path: Path,
    anchor_path: Path,
    style_anchor_path: Path,
) -> PanelQC:
    qc_block = shot.get("qc") or {}
    required = list(qc_block.get("required_strings", []))
    forbidden = list(qc_block.get("forbidden_strings", []))
    rubric_threshold = int(qc_block.get("rubric_threshold", 7))
    style_threshold = int(qc_block.get("style_threshold", STYLE_DRIFT_THRESHOLD))

    # Vision pass for OCR + rubric
    prompt_text = qc_block.get("prompt_summary") or shot.get("role", "")
    try:
        vision = run_vision_pass(
            client, panel_path=panel_path, anchor_path=anchor_path,
            prompt_text=prompt_text,
        )
    except Exception as e:
        logger.warning("shot %d: vision call failed: %s", shot["id"], e)
        vision = {
            "extracted_text": [],
            "character_match": 0, "style_match": 0, "prompt_adherence": 0,
            "notes": f"vision-call error: {e}",
        }

    # Layer A — assertions
    layer_a = check_assertions(
        extracted_text=vision.get("extracted_text", []),
        required=required,
        forbidden=forbidden,
    )

    # Layer B — rubric
    cm = int(vision.get("character_match", 0))
    sm = int(vision.get("style_match", 0))
    pa = int(vision.get("prompt_adherence", 0))
    layer_b = LayerBResult(
        character_match=cm, style_match=sm, prompt_adherence=pa,
        notes=str(vision.get("notes", ""))[:300],
        passed=(cm >= rubric_threshold and sm >= rubric_threshold
                and pa >= rubric_threshold),
    )

    # Layer C — style hash
    layer_c = check_style_hash(
        panel_path=panel_path, anchor_path=style_anchor_path,
        threshold=style_threshold,
    )

    return PanelQC(
        shot_id=int(shot["id"]),
        panel_path=str(panel_path),
        role=str(shot.get("role", "")),
        layer_a=layer_a, layer_b=layer_b, layer_c=layer_c,
    )


def render_table(results: list[PanelQC]) -> None:
    table = Table(title="Panel QC results", show_lines=True)
    table.add_column("Shot", justify="right")
    table.add_column("Layer A — OCR / assertions", justify="left")
    table.add_column("Layer B — rubric (char/style/prompt)", justify="left")
    table.add_column("Layer C — style hash", justify="left")
    table.add_column("Verdict", justify="center")

    for r in results:
        a_status = "[green]✓[/green]" if r.layer_a.passed else "[red]✗[/red]"
        a_detail = f"{a_status} found {len(r.layer_a.required_found)}/{len(r.layer_a.required_found) + len(r.layer_a.required_missing)}"
        if r.layer_a.required_missing:
            a_detail += f"\n  miss: {', '.join(r.layer_a.required_missing[:3])}"
        if r.layer_a.forbidden_found:
            a_detail += f"\n  bad: {', '.join(r.layer_a.forbidden_found[:3])}"

        b_status = "[green]✓[/green]" if r.layer_b.passed else "[red]✗[/red]"
        b_detail = f"{b_status} {r.layer_b.character_match}/{r.layer_b.style_match}/{r.layer_b.prompt_adherence}"
        if r.layer_b.notes:
            b_detail += f"\n  {r.layer_b.notes[:80]}"

        c_status = "[green]✓[/green]" if r.layer_c.passed else "[red]✗[/red]"
        c_detail = f"{c_status} d={r.layer_c.distance} (≤{r.layer_c.threshold})"

        verdict = "[bold green]PASS[/bold green]" if r.all_passed else "[bold red]FAIL[/bold red]"
        table.add_row(str(r.shot_id), a_detail, b_detail, c_detail, verdict)

    console.print(table)


def main() -> int:
    p = argparse.ArgumentParser(description="QC AI-generated comic panels")
    p.add_argument("--storyboard", required=True, help="path to storyboard YAML")
    p.add_argument("--version", default="",
                   help="if set, check vfd_shot_NN.<version>.png instead of .png")
    p.add_argument("--shots", help="comma-separated shot IDs to check (default all)")
    args = p.parse_args()

    storyboard_path = Path(args.storyboard).resolve()
    if not storyboard_path.exists():
        raise SystemExit(f"storyboard not found: {storyboard_path}")
    storyboard = yaml.safe_load(storyboard_path.read_text())

    shot_filter: set[int] | None = None
    if args.shots:
        shot_filter = {int(x) for x in args.shots.split(",")}

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY not set — run under `doppler run ...`")
    client = OpenAI(api_key=api_key)

    results: list[PanelQC] = []
    for shot in storyboard["shots"]:
        shot_id = int(shot["id"])
        if shot_filter and shot_id not in shot_filter:
            continue

        # Resolve the panel file, optionally with version suffix
        base = Path(shot["file"])
        if args.version:
            panel_name = f"{base.stem}.{args.version}{base.suffix}"
        else:
            panel_name = base.name
        panel_path = REF_DIR / panel_name
        if not panel_path.exists():
            logger.warning("shot %d: panel missing at %s — skipping", shot_id, panel_path)
            continue

        # Resolve anchor (for both vision call and style hash)
        qc_block = shot.get("qc") or {}
        anchor_name = qc_block.get("style_anchor")
        if anchor_name:
            style_anchor_path = REF_DIR / anchor_name
        else:
            # Fall back to the v1 of the same shot if no anchor specified.
            style_anchor_path = REF_DIR / f"{base.stem}.v1{base.suffix}"
        if not style_anchor_path.exists():
            logger.warning("shot %d: style anchor missing at %s — using panel itself",
                           shot_id, style_anchor_path)
            style_anchor_path = panel_path

        logger.info("[shot %d] QC %s (anchor: %s)",
                    shot_id, panel_path.name, style_anchor_path.name)
        result = qc_one_shot(
            client, shot=shot, panel_path=panel_path,
            anchor_path=style_anchor_path,
            style_anchor_path=style_anchor_path,
        )
        results.append(result)
        # Throttle to stay under OpenAI's per-minute token limit.
        if shot != storyboard["shots"][-1]:
            time.sleep(5.0)

    if not results:
        raise SystemExit("no panels QC'd — check --shots and file paths")

    render_table(results)

    # Persist JSON report
    OUTPUT_QC_DIR.mkdir(parents=True, exist_ok=True)
    version_tag = args.version or "current"
    report_path = OUTPUT_QC_DIR / f"{storyboard_path.stem}_{version_tag}.json"
    report = {
        "storyboard": str(storyboard_path),
        "version": version_tag,
        "n_panels": len(results),
        "n_passed": sum(1 for r in results if r.all_passed),
        "panels": [asdict(r) for r in results],
    }
    report_path.write_text(json.dumps(report, indent=2))
    console.print(f"\n[dim]Report: {report_path}[/dim]")

    n_failed = sum(1 for r in results if not r.all_passed)
    if n_failed:
        console.print(f"\n[bold red]✗ {n_failed}/{len(results)} panels failed QC[/bold red]")
        return 1
    console.print(f"\n[bold green]✓ All {len(results)} panels passed QC[/bold green]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
