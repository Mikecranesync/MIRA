"""Canonical UNS paths for SimLab + MQTT/display projections.

THE critical contract (locked per advisor review):

  * The **canonical** path is a lowercase, slug-normalized, **dot-delimited
    ltree** string rooted at ``enterprise`` — exactly the shape every other
    MIRA subsystem stores (existing scenarios use ``enterprise.plant1.…``;
    ``mira-relay/tag_ingest.py`` does ``CAST(:uns_path AS LTREE)`` which a
    slash- or MixedCase-form would fail; ``.claude/rules/uns-compliance.md`` §7
    mandates lowercase). Example::

        enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz

  * The user-facing/spec hierarchy
    ``FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01/Filler01/process/fill_level_oz``
    is a **display + MQTT-topic projection ONLY**, produced by
    :func:`to_mqtt_topic`. It is never stored as ``uns_path``.

So: store canonical, project for MQTT/HMI. One ``.``↔``/`` mapping, here.
"""

from __future__ import annotations

import re

# Canonical structural roots for the juice-bottling demo line.
ENTERPRISE = "enterprise"
SITE = "florida_natural_demo"
PLANT = "plant1"
AREA = "juice_bottling"
LINE = "line01"

# Display labels for the MQTT/HMI projection. The enterprise root displays as
# "FactoryLM"; structural segments display as PascalCase unless overridden.
DISPLAY_LABELS: dict[str, str] = {
    ENTERPRISE: "FactoryLM",
    SITE: "FloridaNaturalDemo",
    PLANT: "Plant1",
    AREA: "JuiceBottling",
    LINE: "Line01",
}

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slug(text: str) -> str:
    """Lowercase, runs of non-alphanumerics → '_'. Mirrors
    ``mira-crawler/ingest/uns.slug`` and ``mira-relay`` normalize_tag_path."""
    if not text:
        return ""
    return _NON_ALNUM.sub("_", text.strip().lower()).strip("_")


def uns_join(*segments: str) -> str:
    """Join already-structural segments into a canonical ltree path (each slugged)."""
    return ".".join(slug(s) for s in segments if s)


def line_path() -> str:
    """Canonical UNS path of the juice-bottling line."""
    return uns_join(ENTERPRISE, SITE, PLANT, AREA, LINE)


def asset_path(asset_id: str) -> str:
    """Canonical UNS path of an asset on the line."""
    return f"{line_path()}.{slug(asset_id)}"


def tag_path(asset_id: str, category: str, tag: str) -> str:
    """Canonical UNS path of a single tag: ``<asset>.<category>.<tag>``."""
    return f"{asset_path(asset_id)}.{slug(category)}.{slug(tag)}"


def _display_segment(seg: str) -> str:
    """Project one canonical segment to its display token."""
    if seg in DISPLAY_LABELS:
        return DISPLAY_LABELS[seg]
    # PascalCase from slug: "florida_natural_demo" -> "FloridaNaturalDemo".
    return "".join(w.capitalize() for w in seg.split("_"))


def to_mqtt_topic(uns_path: str) -> str:
    """Project a canonical tag UNS path to its MQTT topic / display path.

    The last two segments of a tag path are ``<category>.<tag>`` and are kept
    verbatim (lowercase); every segment before them is a STRUCTURAL node and is
    display-cased. So::

        enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz
            ->  FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01/Filler01/process/fill_level_oz
    """
    segs = uns_path.split(".")
    if len(segs) < 2:
        return "/".join(segs)
    structural, leaf = segs[:-2], segs[-2:]
    projected = [_display_segment(s) for s in structural] + leaf
    return "/".join(projected)


def to_display_path(uns_path: str) -> str:
    """Human breadcrumb for HMI/Hub. Same projection as MQTT but '/'-joined
    structural display tokens only (no category/tag). Asset-or-tag tolerant."""
    return to_mqtt_topic(uns_path)


def from_mqtt_topic(topic: str) -> str:
    """Inverse of :func:`to_mqtt_topic` — MQTT topic → canonical ltree path.

    Display tokens are re-slugged; ``FactoryLM`` maps back to ``enterprise``.
    """
    inverse = {v: k for k, v in DISPLAY_LABELS.items()}
    out = []
    for seg in topic.split("/"):
        out.append(inverse.get(seg, slug(seg)))
    return ".".join(out)
