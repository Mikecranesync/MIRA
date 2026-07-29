"""Layer A — schema validation via the REAL runtime loader.

Reuses ``mira-bots/shared/drive_packs/loader.py`` (production parsing +
validation code) as the single source of truth for pack shape. This module
does not reimplement any schema rule — see GRADING_SPEC.md's Layer A.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from report import LayerResult

# The loader lives at mira-bots/shared/drive_packs/loader.py and resolves its
# own packs/ directory relative to itself. Its public load_pack(pack_id) has
# no directory override, so for grading a candidate pack that isn't (yet)
# installed alongside the loader, we read the JSON ourselves and hand it to
# the loader's own _parse_pack — same validation logic, just a caller-chosen
# file location.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SHARED_DIR = _REPO_ROOT / "mira-bots" / "shared"
if _SHARED_DIR.is_dir() and str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from drive_packs.loader import _parse_pack, load_pack  # noqa: E402


def check_schema(pack_id: str, packs_dir: str | Path | None = None) -> LayerResult:
    """Validate ``pack_id`` through the real production loader.

    ``packs_dir`` is None -> load exactly the way production does, from the
    co-located ``mira-bots/shared/drive_packs/packs/`` directory. When given,
    reads ``packs_dir/pack_id/pack.json`` directly and validates it through
    the loader's own ``_parse_pack`` (still the production validation code,
    just not gated behind the loader's hardcoded directory lookup) — this is
    what lets grading run against a candidate pack that hasn't been installed
    into the runtime ``packs/`` tree yet.

    ``ValueError``/``FileNotFoundError`` from the loader are fail-closed:
    caught here and reported as a failed layer, never re-raised.
    """
    try:
        if packs_dir is None:
            pack = load_pack(pack_id)
        else:
            path = Path(packs_dir) / pack_id / "pack.json"
            if not path.is_file():
                raise FileNotFoundError(f"no pack.json for pack_id={pack_id!r} (looked at {path})")
            raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
            pack = _parse_pack(raw, pack_id, str(path))
    except (ValueError, FileNotFoundError) as exc:
        return LayerResult(
            name="schema",
            status="fail",
            summary=f"schema validation FAILED: {exc}",
            details=[str(exc)],
            metrics={},
        )

    fault_count = len(pack.live_decode.fault_codes)
    param_count = len(pack.parameters)
    return LayerResult(
        name="schema",
        status="pass",
        summary=(
            f"schema OK (schema_version={pack.schema_version}) — "
            f"{fault_count} fault codes, {param_count} parameters"
        ),
        details=[],
        metrics={
            "fault_count": fault_count,
            "param_count": param_count,
            "schema_version": pack.schema_version,
        },
    )
