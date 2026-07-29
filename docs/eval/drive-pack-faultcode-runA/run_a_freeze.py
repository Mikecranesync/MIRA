#!/usr/bin/env python3.12
"""Run A — freeze the unchanged G+ Mini fault-code baseline.

READ-ONLY. This harness imports the REAL production drive-pack loader/schema
(mira-bots/shared/drive_packs) and exercises it against the G+ Mini case. It
does NOT modify the schema, add fallback, or improve extraction. It writes only
into this baseline directory (extractor_output/, metrics.json, run.log, env.json)
— never into production code, never into packs/, gold/, or candidates/.

Three scenarios establish the honest Run-A floor:

  S1  Data-availability floor: resolve_pack() against G+ Mini identity text ->
      None (no pack matches; there is no source material — see
      raw_inputs/NO_SOURCE_MATERIAL.md).

  S2  Schema-gate floor (field level): feed the mnemonic-keyed fault_codes from
      the synthetic probe to the REAL loader._int_keyed() -> deterministic
      ValueError on the first non-numeric key.

  S3  Schema-gate floor (whole pack): feed the full synthetic probe pack to the
      REAL loader._parse_pack() -> the pack fails to load ENTIRELY (not
      near-empty) because fault_codes is validated by _int_keyed at load time.

Usage:  python3.12 run_a_freeze.py
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]  # docs/eval/drive-pack-faultcode-runA -> repo root
SHARED = REPO / "mira-bots" / "shared"
sys.path.insert(0, str(SHARED))

from drive_packs import loader, schema  # noqa: E402  (real production modules)


def _git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(REPO), *args], text=True).strip()
    except Exception as exc:  # pragma: no cover - env metadata is best-effort
        return f"<git error: {exc}>"


def _pack_version(pack_id: str) -> str:
    """schema_version currently shipped for a live pack, read-only."""
    p = SHARED / "drive_packs" / "packs" / pack_id / "pack.json"
    if not p.is_file():
        return "<no shipped pack>"
    try:
        return str(json.loads(p.read_text())["schema_version"])
    except Exception as exc:
        return f"<read error: {exc}>"


def main() -> int:
    log: list[str] = []

    def emit(line: str = "") -> None:
        print(line)
        log.append(line)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    probe_path = HERE / "raw_inputs" / "gplus_mini_faultcodes_synthetic_probe.json"
    probe = json.loads(probe_path.read_text())

    emit("=" * 72)
    emit("RUN A — FROZEN G+ MINI FAULT-CODE BASELINE (read-only)")
    emit(f"executed_utc={ts}")
    emit(f"repo_commit={_git('rev-parse', 'HEAD')}")
    emit(f"python={platform.python_version()}  platform={platform.platform()}")
    emit(f"loader={loader.__file__}")
    emit(f"schema.LiveDecode.fault_codes annotation = "
         f"{schema.LiveDecode.__annotations__['fault_codes']!r}")
    emit(f"loader supported schema_versions = {sorted(loader._SUPPORTED_SCHEMA_VERSIONS)}")
    emit("=" * 72)

    metrics: dict[str, object] = {
        "run": "A",
        "subject": "IMPULSE G+ Mini (crane/hoist VFD, mnemonic fault codes)",
        "executed_utc": ts,
        "repo_commit": _git("rev-parse", "HEAD"),
        "python": platform.python_version(),
        "schema_repaired": False,
        "fallback_enabled": False,
        "extraction_improved": False,
    }

    # ── S1: data-availability floor ──────────────────────────────────────────
    emit("\n[S1] Data-availability floor — resolve_pack() over shipped packs")
    shipped = loader.list_packs()
    emit(f"     shipped packs = {shipped}")
    for text in ("IMPULSE G+ Mini crane VFD", "Magnetek G+ Mini", "G+ Mini hoist drive"):
        hit = loader.resolve_pack(text)
        emit(f"     resolve_pack({text!r:40}) -> {hit.pack_id if hit else None}")
    s1_matches = any(loader.resolve_pack(t) for t in
                     ("IMPULSE G+ Mini crane VFD", "Magnetek G+ Mini", "G+ Mini hoist drive"))
    emit(f"     RESULT: G+ Mini resolves to a pack? {s1_matches}  (expected: False — no source)")

    # ── S2: schema-gate floor (field level) ──────────────────────────────────
    emit("\n[S2] Schema-gate floor — real loader._int_keyed() on mnemonic fault_codes")
    raw_fc = probe["live_decode"]["fault_codes"]
    emit(f"     probe fault_codes keys = {list(raw_fc)}")
    s2_error = None
    try:
        loader._int_keyed(raw_fc, pack_id=probe["pack_id"], field_name="fault_codes")
        emit("     UNEXPECTED: _int_keyed accepted mnemonic keys")
    except ValueError as exc:
        s2_error = str(exc)
        emit(f"     ValueError (deterministic, fail-closed): {s2_error}")

    # ── S3: schema-gate floor (whole pack) ───────────────────────────────────
    emit("\n[S3] Schema-gate floor — real loader._parse_pack() on the full probe")
    s3_error = None
    try:
        loader._parse_pack(probe, probe["pack_id"], str(probe_path))
        emit("     UNEXPECTED: pack parsed")
    except ValueError as exc:
        s3_error = str(exc)
        emit(f"     ValueError (pack fails to load ENTIRELY, not near-empty): {s3_error}")

    # ── Honest floor metrics ─────────────────────────────────────────────────
    total_source_tokens = len(raw_fc)
    metrics.update({
        "gplus_mini_source_material_present": False,
        "gplus_mini_resolves_to_pack": bool(s1_matches),
        "shipped_packs": shipped,
        "probe_mnemonic_tokens_total": total_source_tokens,
        "raw_tokens_captured_by_schema": 0,
        "fault_codes_deterministically_resolved": 0,
        "fault_codes_via_fallback": 0,
        "fault_codes_unresolved": total_source_tokens,
        "pct_deterministic": 0.0,
        "pct_fallback": 0.0,
        "pct_unresolved": 100.0,
        "gplus_mini_pack_coverage_pct": 0.0,
        "field_level_gate_error": s2_error,
        "pack_level_gate_error": s3_error,
        "pack_loads_at_all": s3_error is None,
        "hard_failures": 0,  # Run A neither guesses nor emits any answer -> zero unsafe outputs
        "citation_accuracy": None,  # N/A: no answers emitted
        "latency_ms": None,         # N/A: no model calls
        "token_cost": 0,            # N/A: no model calls
        "compat_sensitive_readers": [
            "mira-bots/shared/live_snapshot.py:48  (_FAULT_CODES: dict[int,str] = _GS10_PACK.live_decode.fault_codes)",
            "mira-bots/shared/drive_packs/loader.py:275  (_int_keyed gate — produces this floor)",
            "mira-bots/shared/drive_packs/cards.py:89  (provenance read)",
            "mira-bots/shared/drive_packs/cards.py:93  (for code, name in pack.live_decode.fault_codes.items())",
            "mira-bots/shared/drive_packs/template_reader.py  (numeric fault_code keying; mirrors docs/migrations/002_fault_codes.sql)",
        ],
        "abstraction_leak": (
            "GS10 already smuggles mnemonic identity into the VALUE string under an "
            "INT key (e.g. '21' -> 'oL overload', '58' -> 'CE10 modbus timeout'); "
            "mnemonic identity has no first-class field today, so dict[int,str] is "
            "already a leaky abstraction even for a 'supported' drive."
        ),
    })

    emit("\n" + "=" * 72)
    emit("HONEST RUN-A FLOOR")
    emit(f"     source material present ............ {metrics['gplus_mini_source_material_present']}")
    emit(f"     deterministic resolution ........... {metrics['pct_deterministic']}%")
    emit(f"     fallback ........................... {metrics['pct_fallback']}%")
    emit(f"     unresolved ......................... {metrics['pct_unresolved']}%")
    emit(f"     raw tokens captured by schema ...... {metrics['raw_tokens_captured_by_schema']}")
    emit(f"     G+ Mini pack coverage .............. {metrics['gplus_mini_pack_coverage_pct']}%")
    emit(f"     hard failures (unsafe guesses) ..... {metrics['hard_failures']}")
    emit("=" * 72)

    # ── write outputs (this dir only) ────────────────────────────────────────
    out_dir = HERE / "extractor_output"
    (out_dir / "loader_rejection.txt").write_text(
        "Field-level (_int_keyed):\n" + (s2_error or "<none>") + "\n\n"
        "Pack-level (_parse_pack):\n" + (s3_error or "<none>") + "\n"
    )
    # The "extracted pack" the current production path yields for G+ Mini:
    (out_dir / "gplus_mini_pack_result.json").write_text(json.dumps({
        "pack_id": "impulse_gplus_mini",
        "loaded": False,
        "reason": "load_pack would raise FileNotFoundError (no shipped pack); a "
                  "source-preserving mnemonic-keyed pack raises ValueError at "
                  "loader.py:275 (_int_keyed). Either way: zero usable fault decode.",
        "fault_codes_decoded": {},
    }, indent=2) + "\n")

    (HERE / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    env = {
        "executed_utc": ts,
        "repo_commit": _git("rev-parse", "HEAD"),
        "repo_branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "loader_path": loader.__file__,
        "schema_path": schema.__file__,
        "fault_codes_annotation": str(schema.LiveDecode.__annotations__["fault_codes"]),
        "loader_supported_schema_versions": sorted(loader._SUPPORTED_SCHEMA_VERSIONS),
        "gs10_pack_version": _pack_version("durapulse_gs10"),
        "powerflex_525_pack_version": _pack_version("powerflex_525"),
        "powerflex_40_pack_version": _pack_version("powerflex_40"),
        "extractor_dir": "tools/drive-pack-extract",
    }
    (HERE / "env.json").write_text(json.dumps(env, indent=2) + "\n")
    (HERE / "run.log").write_text("\n".join(log) + "\n")

    emit("\nwrote: extractor_output/loader_rejection.txt, "
         "extractor_output/gplus_mini_pack_result.json, metrics.json, env.json, run.log")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
