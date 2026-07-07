"""Bridge: successful manual KB ingest → drive-pack UPDATE CANDIDATE (default-off).

When ``kb_growth_cron`` finishes ingesting a manual PDF into the KB, this bridge
*optionally* turns that event into a **review-only drive-pack update candidate**
— IF the PDF belongs to a known drive family (registry match) and its hash is
new or changed. It NEVER extracts/grades inline, NEVER promotes, NEVER touches a
trusted pack, and NEVER fails the KB ingest.

Doctrine (``docs/drive-commander/runbook-do-not-silently-trust-updated-manuals.md``):
a discovered/changed manual may create a CANDIDATE; trust only comes later, after
extraction + grading + cite-integrity + domain checks + human approval. This
module does step 1 (create the candidate record); the rest is deliberate and human-gated.

Design:
- **Default OFF** behind ``MIRA_DRIVE_PACK_BRIDGE=1``.
- **Honors ``~/.mira/STOP_INGEST``** (same kill switch the AB hunter respects).
- **Fail-open everywhere:** any error returns a ``status="error"`` record and is
  swallowed — the caller (KB ingest) still succeeds.
- Writes the candidate record only under a runtime dir (``~/.mira/drive-pack-candidates/``
  by default), NEVER into ``mira-bots/shared/drive_packs/packs/`` and NEVER into
  the committed ``candidates/`` tree.
- Extraction + grading is a separate, later step: the record carries the exact
  ``update_candidate.py`` command to run.

All I/O paths are injectable so the whole thing is unit-testable offline.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
from pathlib import Path
from typing import Any

_HOME = Path.home()
_CRAWLER_DIR = Path(__file__).resolve().parent  # mira-crawler/
_REPO_ROOT = _CRAWLER_DIR.parent
_REGISTRY_PY = _REPO_ROOT / "tools" / "drive-pack-extract" / "registry" / "registry.py"

# Defaults (all overridable via env / function args for tests + non-standard deploys).
DEFAULT_MANUALS_ROOT = Path(os.getenv("MANUALS_ROOT", "/opt/mira/manuals"))
DEFAULT_STOP_FLAG = _HOME / ".mira" / "STOP_INGEST"
DEFAULT_CANDIDATE_DIR = Path(
    os.getenv("MIRA_DRIVE_PACK_CANDIDATE_DIR", str(_HOME / ".mira" / "drive-pack-candidates"))
)

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


# --------------------------------------------------------------------------
# Pure helpers (unit-tested)
# --------------------------------------------------------------------------


def bridge_enabled(env: dict[str, str] | None = None) -> bool:
    env = env if env is not None else os.environ
    return env.get("MIRA_DRIVE_PACK_BRIDGE", "0") == "1"


def stop_ingest_active(stop_flag: str | Path) -> bool:
    """Honor the shared ingest kill switch (``~/.mira/STOP_INGEST``)."""
    return Path(stop_flag).exists()


def _norm(s: str | None) -> str:
    return _NON_ALNUM.sub("", (s or "").lower())


def resolve_local_pdf(entry: dict[str, Any], manuals_root: str | Path) -> Path | None:
    """Reconstruct the cached PDF path the ingest pipeline downloaded to, read-only.

    Mirrors ``mira-crawler/tasks/full_ingest_pipeline.py`` (~line 574):
        MANUALS_ROOT / mfr.replace('/','-') / model.replace('/','-') / basename(url)[.pdf]
    The pipeline caches (doesn't delete) the PDF, so after a successful ingest the
    file exists here. Returns None if it doesn't (→ bridge fails open)."""
    url = entry.get("url") or ""
    mfr = (entry.get("manufacturer") or "").replace("/", "-")
    model = (entry.get("model") or "").replace("/", "-")
    if not url:
        return None
    base = Path(url.split("?")[0]).name or "manual.pdf"
    dest = Path(manuals_root) / mfr / model / base
    if not dest.suffix:
        dest = dest.with_suffix(".pdf")
    return dest if dest.is_file() else None


def match_registry_entry(
    registry: dict[str, Any], manufacturer: str | None, model: str | None
) -> dict[str, Any] | None:
    """Map a discovered ``(manufacturer, model)`` onto a known registry entry.

    Matches primarily on MODEL against the entry's ``applicable_drive_models`` +
    ``product_family`` (model is far more discriminating than the vendor string —
    e.g. discovery says "Allen-Bradley" while the registry says "Rockwell
    Automation" for the same PowerFlex drive). Returns the entry or None."""
    nmodel = _norm(model)
    if not nmodel:
        return None
    for entry in registry.get("manuals", []):
        tokens = {_norm(m) for m in entry.get("applicable_drive_models", [])}
        tokens.add(_norm(entry.get("product_family")))
        tokens.discard("")
        if nmodel in tokens or any(nmodel and (nmodel in t or t in nmodel) for t in tokens):
            return entry
    return None


def build_candidate_record(
    *,
    reg_entry: dict[str, Any],
    entry: dict[str, Any],
    pdf_sha256: str,
    change_state: str,
    local_pdf: str,
    ingest_timestamp: str,
) -> dict[str, Any]:
    """The review-only candidate record. Provenance-complete; hard ``promoted:false``
    and ``trust_status:"candidate"`` — it can never read as a trusted pack."""
    return {
        "kind": "drive_pack_update_candidate",
        "created_by": "kb_growth_bridge",
        "review_only": True,
        "promoted": False,  # a bridge candidate is NEVER promoted
        "trust_status": "candidate",  # NOT 'trusted' — trust is earned later, by a human
        "change_state": change_state,
        "registry_manual_id": reg_entry.get("manual_id"),
        "manual_source": {
            "manufacturer": entry.get("manufacturer"),  # as discovered
            "model": entry.get("model"),  # as discovered
            "manual_id": reg_entry.get("manual_id"),
            "vendor": reg_entry.get("vendor"),
            "product_family": reg_entry.get("product_family"),
            "publication": reg_entry.get("publication"),
            "revision": reg_entry.get("revision"),
            "source_url": entry.get("url"),
            "source_classification": reg_entry.get("source_classification"),
        },
        "pdf_sha256": pdf_sha256,
        "previously_registered_sha256": reg_entry.get("pdf_sha256"),
        "ingest_timestamp": ingest_timestamp,
        "local_pdf_path": local_pdf,
        "next_step": (
            "python tools/drive-pack-extract/registry/update_candidate.py "
            f"--manual {local_pdf} --id {reg_entry.get('manual_id')}"
        ),
        "note": (
            "REVIEW-ONLY. A changed/new manual creates this candidate; it does NOT replace a "
            "trusted pack. Trust requires extraction + grading + cite-integrity + domain checks "
            "+ human approval (docs/drive-commander/runbook-drive-manual-update-acceptance.md). "
            "This record never modifies mira-bots/shared/drive_packs/packs/."
        ),
    }


# --------------------------------------------------------------------------
# Registry loader (imported from the hyphenated tool dir, lazily + cached)
# --------------------------------------------------------------------------

_registry_mod: Any = None


def _load_registry_module(registry_py: Path = _REGISTRY_PY) -> Any:
    global _registry_mod
    if _registry_mod is not None:
        return _registry_mod
    spec = importlib.util.spec_from_file_location("_drive_pack_registry", str(registry_py))
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"cannot load registry module from {registry_py}")
    mod = importlib.util.module_from_spec(spec)
    # Register before exec: dataclasses (the registry defines one) resolves
    # ``sys.modules[cls.__module__].__dict__`` during class creation, which is
    # None for an unregistered module (Python 3.12+ / 3.14 hard-fails).
    import sys

    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    _registry_mod = mod
    return mod


# --------------------------------------------------------------------------
# The bridge entry point — NEVER raises (returns a status record)
# --------------------------------------------------------------------------


def maybe_create_candidate(
    entry: dict[str, Any],
    *,
    local_pdf: str | Path | None = None,
    registry_path: str | Path | None = None,
    registry_py: str | Path | None = None,
    manuals_root: str | Path | None = None,
    candidate_dir: str | Path | None = None,
    stop_flag: str | Path | None = None,
    env: dict[str, str] | None = None,
    now_iso: str = "unknown",
) -> dict[str, Any]:
    """Given a just-ingested queue entry, optionally create a drive-pack update
    candidate. Returns a status dict; NEVER raises (the caller's KB ingest must
    not be affected by anything here).

    status ∈ {disabled, stopped, skipped, unchanged, candidate_created, error}.
    """
    try:
        if not bridge_enabled(env):
            return {"status": "disabled", "reason": "MIRA_DRIVE_PACK_BRIDGE != 1"}

        stop = Path(stop_flag) if stop_flag is not None else DEFAULT_STOP_FLAG
        if stop_ingest_active(stop):
            return {"status": "stopped", "reason": "STOP_INGEST set — bridge skipped"}

        pdf = (
            Path(local_pdf)
            if local_pdf
            else resolve_local_pdf(
                entry, manuals_root if manuals_root is not None else DEFAULT_MANUALS_ROOT
            )
        )
        if pdf is None or not Path(pdf).is_file():
            return {
                "status": "skipped",
                "reason": "no_local_pdf",
                "report": f"no cached PDF for manufacturer={entry.get('manufacturer')!r} "
                f"model={entry.get('model')!r} url={entry.get('url')!r}",
            }

        reg = _load_registry_module(Path(registry_py) if registry_py else _REGISTRY_PY)
        registry = reg.load_registry(registry_path)  # None → shipped sources.json
        reg_entry = match_registry_entry(registry, entry.get("manufacturer"), entry.get("model"))
        if reg_entry is None:
            return {
                "status": "skipped",
                "reason": "no_registry_match",
                "report": f"no drive-pack registry entry matches manufacturer="
                f"{entry.get('manufacturer')!r} model={entry.get('model')!r} — "
                "register the source first (workflow-register-a-manual-source.md)",
            }

        sha = reg.sha256_file(pdf)
        cls = reg.classify(reg_entry, sha)

        if cls.state == reg.UNCHANGED:
            return {
                "status": "unchanged",
                "registry_manual_id": reg_entry.get("manual_id"),
                "pdf_sha256": sha,
                "reason": "hash matches the approved pdf_sha256 — no candidate",
            }

        # changed_by_hash or needs_initial_candidate (a known but not-yet-hashed manual)
        record = build_candidate_record(
            reg_entry=reg_entry,
            entry=entry,
            pdf_sha256=sha,
            change_state=cls.state,
            local_pdf=str(pdf),
            ingest_timestamp=now_iso,
        )
        cdir = Path(candidate_dir) if candidate_dir is not None else DEFAULT_CANDIDATE_DIR
        out_dir = cdir / str(reg_entry.get("manual_id"))
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"candidate-{sha[:12]}.json"
        out_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        return {
            "status": "candidate_created",
            "registry_manual_id": reg_entry.get("manual_id"),
            "change_state": cls.state,
            "pdf_sha256": sha,
            "candidate_path": str(out_path),
        }
    except Exception as exc:  # noqa: BLE001 — fail OPEN: never propagate to KB ingest
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}


if __name__ == "__main__":  # pragma: no cover - manual smoke only
    import sys

    demo = {
        "url": "https://example.com/pf525.pdf",
        "manufacturer": "Allen-Bradley",
        "model": "PowerFlex-525",
    }
    print(
        json.dumps(
            maybe_create_candidate(demo, local_pdf=(sys.argv[1] if len(sys.argv) > 1 else None)),
            indent=2,
        )
    )
