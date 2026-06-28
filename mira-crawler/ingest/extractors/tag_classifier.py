"""AI-assisted tag classifier for Ignition / connector tag manifests.

Spec: docs/research/ignition-tag-client-and-ai-mapper-readiness.md §G-M1
      docs/plans/2026-06-15-ignition-tag-mapper-implementation.md §Phase 1

Takes a tag (from a connector normalize() call or a live doGet.py payload) and
returns a ``TagClassification`` that maps it to one of the 10 UNS-aligned
categories and proposes a UNS path using mira-crawler/ingest/uns.py builders.

Callers persist the result as an ``ai_suggestions`` row of type ``tag_mapping``
(see tools/seeds/factorylm-garage-conveyor.sql lines 198-233 for the exact row
shape). This module only classifies — it never writes to the database.

Usage pattern (Phase 2 wiring)
-------------------------------
    from mira_crawler.ingest.extractors.tag_classifier import classify_tags_batch
    from mira_bots.shared.inference.router import InferenceRouter

    router = InferenceRouter(...)
    tags = connector.normalize()        # list[CanonicalTag] or list[dict]
    results = await classify_tags_batch(tags, router, equipment_path)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Literal, Optional, Protocol, runtime_checkable

from ingest import uns

logger = logging.getLogger("mira-tag-classifier")

# ---------------------------------------------------------------------------
# 10-category taxonomy (UNS-aligned)
# ---------------------------------------------------------------------------

TAG_CATEGORY = Literal[
    "motor_speed",
    "motor_current",
    "motor_temp",
    "conveyor_speed",
    "sensor_discrete",
    "sensor_analog",
    "fault_status",
    "setpoint",
    "counter",
    "unknown",
]

# Category → signal segment under the equipment UNS path
_CATEGORY_SIGNAL_SEGMENT: dict[str, str] = {
    "motor_speed":     "signal.speed",
    "motor_current":   "signal.current",
    "motor_temp":      "signal.temperature",
    "conveyor_speed":  "signal.speed",
    "sensor_discrete": "signal.discrete",
    "sensor_analog":   "signal.analog",
    "fault_status":    "signal.fault",
    "setpoint":        "signal.setpoint",
    "counter":         "signal.counter",
    "unknown":         "signal.unknown",
}


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TagClassification:
    tag_path: str                               # original tag path / ID
    category: str                               # one of TAG_CATEGORY values
    candidate_component_type: Optional[str]     # e.g. "motor", "vfd", "conveyor"
    candidate_line_token: Optional[str]         # slug inferred from path segments
    candidate_asset_token: Optional[str]        # slug inferred from path segments
    suggested_uns_path: str                     # built via uns.py — never hand-formatted
    confidence: float                           # 0.0–1.0; < 0.5 forces category="unknown"


# ---------------------------------------------------------------------------
# Completer protocol — InferenceRouter satisfies this duck-typed
# ---------------------------------------------------------------------------

@runtime_checkable
class _Completer(Protocol):
    async def complete(
        self,
        messages: list[dict],
        max_tokens: int = 256,
    ) -> tuple[str, dict]: ...


# ---------------------------------------------------------------------------
# Core classifier
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a PLC/SCADA tag classification assistant for MIRA, an industrial maintenance AI.
Classify a single tag into exactly one of these categories:
  motor_speed, motor_current, motor_temp, conveyor_speed,
  sensor_discrete, sensor_analog, fault_status, setpoint, counter, unknown

Rules:
- If the tag represents a run/stop/fault digital coil → fault_status or sensor_discrete
- If the tag represents speed or RPM → motor_speed or conveyor_speed
- If the tag represents current (A, Amps) → motor_current
- If the tag represents temperature (°C, °F, C, F) → motor_temp
- If the tag is a setpoint or reference (SP, Ref, Target) → setpoint
- If the tag is a count or accumulation → counter
- If you cannot determine the category with confidence ≥ 0.5 → unknown

Respond with ONLY valid JSON, no prose:
{
  "category": "<one of the 10 values>",
  "candidate_component_type": "<motor|vfd|conveyor|sensor|plc|null>",
  "candidate_line_token": "<lowercase slug or null>",
  "candidate_asset_token": "<lowercase slug or null>",
  "confidence": <0.0 to 1.0>
}"""

_CONFIDENCE_FLOOR = 0.5


async def classify_tag(
    tag: dict[str, Any],
    router: _Completer,
    equipment_path: str = "",
) -> TagClassification:
    """Classify a single tag using the InferenceRouter cascade.

    Parameters
    ----------
    tag:
        Dict with at minimum ``tag_path`` (str). Optional enrichment keys:
        ``data_type``, ``engineering_unit``, ``description``.
        Accepts CanonicalTag.__dict__ or a raw doGet.py payload dict.
    router:
        Any object with ``complete(messages, max_tokens) -> (str, dict)``.
        InferenceRouter satisfies this protocol.
    equipment_path:
        Pre-resolved UNS equipment path (e.g.
        ``enterprise.factorylm.garage.bench.conveyor``) to anchor the
        suggested_uns_path. When empty the path uses ``signal.<slug>``
        relative notation as a best-effort proposal.
    """
    tag_path = tag.get("tag_path") or tag.get("tag_id") or tag.get("path") or ""
    data_type = tag.get("data_type", "float")
    unit = tag.get("engineering_unit") or tag.get("units") or ""
    description = tag.get("description") or tag.get("symbolic_name") or ""

    user_content = (
        f"Tag path: {tag_path}\n"
        f"Data type: {data_type}\n"
        f"Engineering unit: {unit}\n"
        f"Description: {description}"
    )

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    raw, _ = await router.complete(messages, max_tokens=256)

    return _parse_response(raw, tag_path, equipment_path)


def _parse_response(
    raw: str,
    tag_path: str,
    equipment_path: str,
) -> TagClassification:
    """Parse LLM JSON response into a TagClassification.

    Falls back to category='unknown' with confidence=0.0 on any parse error.
    """
    category = "unknown"
    component_type: Optional[str] = None
    line_token: Optional[str] = None
    asset_token: Optional[str] = None
    confidence = 0.0

    if raw:
        # Strip markdown fences if the model added them
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        try:
            data = json.loads(text)
            raw_cat = data.get("category", "unknown")
            if raw_cat not in _CATEGORY_SIGNAL_SEGMENT:
                raw_cat = "unknown"
            confidence = float(data.get("confidence", 0.0))
            if confidence < _CONFIDENCE_FLOOR:
                raw_cat = "unknown"
            category = raw_cat

            comp = data.get("candidate_component_type")
            component_type = None if comp in (None, "null") else str(comp)

            lt = data.get("candidate_line_token")
            line_token = None if lt in (None, "null") else uns.slug(str(lt))

            at = data.get("candidate_asset_token")
            asset_token = None if at in (None, "null") else uns.slug(str(at))

        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning("tag_classifier: parse error tag=%r: %s", tag_path, exc)

    suggested = _build_uns_path(category, tag_path, equipment_path, asset_token)

    return TagClassification(
        tag_path=tag_path,
        category=category,
        candidate_component_type=component_type,
        candidate_line_token=line_token,
        candidate_asset_token=asset_token,
        suggested_uns_path=suggested,
        confidence=confidence,
    )


def _build_uns_path(
    category: str,
    tag_path: str,
    equipment_path: str,
    asset_token: Optional[str],
) -> str:
    """Build a UNS path via uns.py builders.

    Does NOT hand-format paths (UNS compliance rule #1).
    """
    signal_segment = _CATEGORY_SIGNAL_SEGMENT.get(category, "signal.unknown")

    # Derive a slug for the terminal signal node from the tag path
    # e.g. "[default]Mira_Monitored/Motor/Speed" → "speed"
    raw_leaf = tag_path.rstrip("/").rsplit("/", 1)[-1]
    # Strip Ignition address prefix like "[default]" or "HR100"
    raw_leaf = raw_leaf.replace("[default]", "").strip()
    signal_slug = uns.slug(raw_leaf) if raw_leaf else "tag"

    # Split "signal.speed" → ["signal", "speed"] so each part is slugged correctly
    signal_parts = signal_segment.split(".")

    anchor = equipment_path.rstrip(".")
    if anchor:
        if asset_token:
            anchor = uns.equipment_subnode_path(anchor, "component", asset_token)
        return uns.equipment_subnode_path(anchor, *signal_parts, signal_slug)

    # No equipment_path supplied — return a relative path for human review
    if asset_token:
        return f"equipment.{asset_token}.{signal_segment}.{signal_slug}"
    return f"{signal_segment}.{signal_slug}"


# ---------------------------------------------------------------------------
# Batch helper
# ---------------------------------------------------------------------------

async def classify_tags_batch(
    tags: list[dict[str, Any]],
    router: _Completer,
    equipment_path: str = "",
) -> list[TagClassification]:
    """Classify a list of tags sequentially.

    Sequential (not concurrent) to stay within provider rate limits.
    For bulk imports the caller may parallelise externally with throttling.
    """
    results: list[TagClassification] = []
    for tag in tags:
        result = await classify_tag(tag, router, equipment_path)
        results.append(result)
    return results
