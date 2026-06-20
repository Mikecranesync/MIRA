"""The ``.miraprofile`` document format — a saveable, reopenable machine-profile.

A Machine Profile is one asset/machine being contextualized over time: the technician creates it,
adds PLC/CCW exports, manuals, and photos across days, reviews the proposals, and exports a portable
bundle for MIRA Hub. The working state lives in the SQLite store; a ``.miraprofile`` is the explicit,
portable, human-inspectable checkpoint of one profile — everything needed to reopen it on another
machine and keep working, with previous accept/reject decisions intact.

Self-contained, deterministic JSON (stdlib only, no LLM, no network). A profile carries the machine
identity + site/line metadata, the source inventory (with content fingerprints + extracted IR), every
normalized extraction with its review decision and provenance, and the export history.

  save_profile(store, pid)         -> the profile dict (write with write_profile / json.dumps)
  open_profile(store, data)        -> restore the profile into the store, return the new project
  recents_load / recents_add       -> the File ▸ Recent Profiles list (a small JSON sidecar)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from . import __version__
from .store import PROFILE_FIELDS, Store

SCHEMA = "mira-contextualizer/profile@1"
EXT = ".miraprofile"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprint(ir: dict | None, extractions: list[dict]) -> str:
    """A stable content fingerprint for a source: the extracted IR when present, else the source's
    extracted tag set. Deterministic (sorted) so the same source always hashes the same — used for
    Hub-side de-dup / asset matching (``source_file_hashes``)."""
    if ir:
        blob = json.dumps(ir, sort_keys=True)
    else:
        blob = json.dumps(sorted(e["tagName"] for e in extractions), sort_keys=True)
    return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()


def save_profile(store: Store, project_id: str) -> dict:
    """Serialize one project into a ``.miraprofile`` dict. Raises ValueError if it doesn't exist."""
    proj = store.get_project(project_id)
    if not proj:
        raise ValueError("project not found")
    sources = store.list_sources(project_id)
    exts = store.list_extractions(project_id)
    by_source: dict[str, list[dict]] = {}
    for e in exts:
        by_source.setdefault(e["sourceId"], []).append(e)

    src_out = []
    for s in sources:
        full = store.get_source(s["id"])
        ir = full.get("extracted") if full else None
        rows = by_source.get(s["id"], [])
        src_out.append(
            {
                "fileName": s["fileName"],
                "sourceType": s["sourceType"],
                "status": s["status"],
                "errorMessage": s.get("errorMessage"),
                "sha256": _fingerprint(ir, rows),
                "extracted": ir,
                "extractions": [
                    {
                        "tagName": e["tagName"],
                        "roles": e["roles"],
                        "unsPathProposed": e["unsPathProposed"],
                        "i3xElementId": e["i3xElementId"],
                        "evidenceJson": e["evidenceJson"],
                        "confidence": e["confidence"],
                        "status": e["status"],
                    }
                    for e in rows
                ],
            }
        )

    return {
        "schema": SCHEMA,
        "tool": "mira-contextualizer",
        "tool_version": __version__,
        "saved_at": _now(),
        "profile": {
            "id": proj["id"],
            "name": proj["name"],
            "description": proj.get("description"),
            "identity": {
                k: proj.get("profile", {}).get(k)
                for k in PROFILE_FIELDS
                if proj.get("profile", {}).get(k) not in (None, "")
            },
            "createdAt": proj.get("createdAt"),
            "updatedAt": proj.get("updatedAt"),
        },
        "sources": src_out,
        "exports": store.list_exports(project_id),
    }


def write_profile(store: Store, project_id: str, path: str) -> dict:
    """Save a profile to ``path`` (deterministic JSON) and record it in the export history."""
    data = save_profile(store, project_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    store.add_export(project_id, "profile", path)
    return data


def open_profile(store: Store, data: dict | str) -> dict:
    """Restore a ``.miraprofile`` (dict or JSON string) into the store as a new project, preserving
    metadata, sources (+ extracted IR), every extraction, and its review decision. Returns the
    project row."""
    if isinstance(data, str):
        data = json.loads(data)
    if (data or {}).get("schema") != SCHEMA:
        raise ValueError("not a %s document" % SCHEMA)
    prof = data.get("profile") or {}
    proj = store.create_project(
        prof.get("name") or "Imported profile",
        prof.get("description"),
        profile=prof.get("identity") or {},
    )
    pid = proj["id"]
    for s in data.get("sources") or []:
        src = store.create_source(pid, s.get("sourceType") or "other", s["fileName"])
        if s.get("extracted") is not None:
            store.set_source_extraction(src["id"], s["extracted"])
        rows = [
            {
                "tag_name": e["tagName"],
                "roles": e.get("roles") or [],
                "uns_path_proposed": e.get("unsPathProposed"),
                "i3x_element_id": e.get("i3xElementId"),
                "evidence_json": e.get("evidenceJson") or {},
                "confidence": e.get("confidence"),
                "status": e.get("status") or "pending",
            }
            for e in (s.get("extractions") or [])
        ]
        store.add_extractions(pid, src["id"], rows)
        store.set_source_status(src["id"], s.get("status") or "done", s.get("errorMessage"))
    return store.get_project(pid)


# ── File ▸ Recent Profiles ──────────────────────────────────────────────────────
def recents_load(path: str) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def recents_add(path: str, profile_path: str, name: str, limit: int = 10) -> list[dict]:
    """Add (or move to front) a profile path in the recents sidecar, newest first, capped."""
    items = [r for r in recents_load(path) if r.get("path") != profile_path]
    items.insert(0, {"path": profile_path, "name": name, "openedAt": _now()})
    items = items[:limit]
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(items, fh, indent=2)
    except OSError:
        pass
    return items
