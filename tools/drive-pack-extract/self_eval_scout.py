"""Drive Commander self-eval scout — fetch a real OEM VFD manual off the internet,
run it through the drive-pack extractor + scientific grading harness, and email a
complete evaluation.

This is the Drive Commander analogue of the PrintSense/PLC-laptop autonomous
testing loop: instead of a technician's electrical print, the scout pulls a
**real, previously-unseen** manufacturer manual PDF (a family NOT in ``gold/``),
runs the *actual production extractor* over it, grades the resulting pack with the
*actual scientific grading harness* (gold-independent — schema + cite-integrity +
domain-invariant layers), and delivers a complete evaluation email. It proves the
pipeline works end-to-end on inputs nobody hand-curated, and surfaces how well the
extractor *generalises* beyond its tuned families.

Doctrine it inherits from the tool (never weakened here):
- **Read-only.** Reads a PDF it downloaded; never opens a fieldbus, never touches a
  PLC/VFD, never writes to the live served ``packs/`` tree. Its only writes are the
  staged candidate + report under a scratch/out dir. See ``.claude/rules/fieldbus-readonly.md``.
- **Honest, evidence-first.** A thin extraction on an unfamiliar layout is reported
  as a low-recall finding, not hidden. A fetch/parse failure emits an honest
  FAILURE evaluation, never a fake pass (same posture as the dogfood judge).
- **Staged, not deployed.** The candidate pack lives in a scratch dir; nothing is
  promoted to the runtime resolver. Promotion stays human-gated (ADR-0025,
  ``.claude/rules/train-before-deploy.md``).

Usage:
    # dry-run (write the evaluation to a file, do NOT send email):
    python tools/drive-pack-extract/self_eval_scout.py --dry-run
    # send the real evaluation email (needs RESEND_API_KEY in the environment):
    python tools/drive-pack-extract/self_eval_scout.py --send
    # pin a specific target instead of rotating:
    python tools/drive-pack-extract/self_eval_scout.py --send --target durapulse_gs20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# httpx is imported lazily inside fetch_manual/send_email (mirrors
# morning_report.py) so this module — and its pure-logic unit tests — import
# without httpx present (the offline Drive-Pack CI job installs pdfplumber but
# not httpx).

_TOOL_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _TOOL_DIR.parent.parent
_GRADER = _TOOL_DIR / "grading" / "grade_scientific.py"
if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))

import extractor  # noqa: E402  (path set up first)

logger = logging.getLogger("drive-commander-scout")

# --- Targets ---------------------------------------------------------------
#
# Real, publicly-hosted OEM manual PDFs for drive families that are NOT in
# ``gold/`` — so every run is a genuine unseen end-to-end test. Direct-PDF URLs
# from stable manufacturer CDNs (no session/redirect) so a scheduled run stays
# deterministic. Add families here; do not add a family that already has a
# ``gold/<pack_id>/`` set (that would stop being an unseen test).
SCOUT_TARGETS: list[dict[str, Any]] = [
    {
        # Magnetek (Columbus McKinnon) IMPULSE G+ Mini — a crane-hoist VFD, and
        # the pinned first unseen-family target. STRONGLY INFERRED to be a
        # relabeled Yaskawa V1000 (CIMR-VU4A) carrying proprietary Magnetek crane
        # firmware (Load Check, Torque Proving, Swift-Lift, brake-proving faults)
        # — see MAGNETEK_YASKAWA_MATRIX.md. Treated as its OWN family regardless
        # of shared hardware. Fault table is a 3-column mnemonic layout
        # (oC/BE2/LL1) + dotted params (H01.01); the PowerFlex-tuned extractor
        # does not yet parse this shape (the unseen-eval finding — see
        # candidates/magnetek_impulse_g_plus_mini/PROVENANCE.md).
        "pack_id": "magnetek_impulse_g_plus_mini",
        "manufacturer": "Magnetek",
        "series": "IMPULSE G+ Mini",
        "aliases": ["impulse g+ mini", "g+ mini", "gplus mini", "impulse gplus mini"],
        "match_keywords": ["impulse g+ mini", "g+ mini", "magnetek impulse", "gplus mini"],
        "url": "https://www.magnetekdrives.com/wp-content/uploads/sites/7/drives-g-mini-manual.pdf",
        "doc_label": "Magnetek IMPULSE G+ Mini Technical Manual (144-25085)",
        "revision": "144-25085",
        "firmware": "14515",
    },
    {
        "pack_id": "durapulse_gs20",
        "manufacturer": "AutomationDirect",
        "series": "DURApulse GS20",
        "aliases": ["durapulse gs20", "gs20", "gs-20"],
        "match_keywords": ["gs20", "durapulse gs20", "gs20 ac drive"],
        "url": "https://cdn.automationdirect.com/static/manuals/gs20m/gs20m.pdf",
        "doc_label": "DURApulse GS20 AC Drive User Manual",
    },
    {
        "pack_id": "durapulse_gs4",
        "manufacturer": "AutomationDirect",
        "series": "DURApulse GS4",
        "aliases": ["durapulse gs4", "gs4", "gs-4"],
        "match_keywords": ["gs4", "durapulse gs4", "gs4 ac drive"],
        "url": "https://cdn.automationdirect.com/static/manuals/gs4m/gs4m.pdf",
        "doc_label": "DURApulse GS4 AC Drive User Manual",
    },
]

_REQUIRED_TOP_LEVEL_KEYS = (
    "pack_id",
    "schema_version",
    "family",
    "nameplate",
    "live_decode",
    "envelope",
    "knowledge",
    "provenance",
    "parameters",
    "keypad_navigation",
)

RESEND_FROM = "mira@factorylm.com"
RESEND_TO_DEFAULT = "harperhousebuyers@gmail.com"


def _sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _gold_families() -> set[str]:
    gold_dir = _TOOL_DIR / "gold"
    return {p.name for p in gold_dir.iterdir() if p.is_dir()} if gold_dir.is_dir() else set()


def _history_path(out_dir: Path) -> Path:
    return out_dir / "history.json"


def _load_history(out_dir: Path) -> list[dict[str, Any]]:
    """Return the recorded run history (list of attempt dicts). Missing/corrupt
    history is treated as empty — the scout must never crash on a bad log."""
    path = _history_path(out_dir)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        attempts = data.get("attempts", []) if isinstance(data, dict) else []
        return [a for a in attempts if isinstance(a, dict)]
    except Exception as exc:  # noqa: BLE001 — a bad log must not stop a run
        logger.warning("could not read history %s: %s", path, exc)
        return []


def _graded_families(history: list[dict[str, Any]]) -> set[str]:
    """Families that already have a COMPLETED (GRADED) evaluation. A failed
    fetch/extract is recorded but does NOT retire the family — so a transient
    outage retries, while a real evaluation is never duplicated."""
    return {a["pack_id"] for a in history if a.get("status") == "GRADED" and a.get("pack_id")}


def record_attempt(out_dir: Path, target: dict[str, Any], result: dict[str, Any]) -> None:
    """Append this run to the shared history (manual AND scheduled runs land in
    the same file). Records manufacturer, family, revision, firmware, sha256,
    status and timestamp per the Phase-4 spec. Best-effort — never raises."""
    history = _load_history(out_dir)
    history.append(
        {
            "pack_id": target["pack_id"],
            "manufacturer": target.get("manufacturer"),
            "series": target.get("series"),
            "revision": target.get("revision"),
            "firmware": target.get("firmware"),
            "source_url": target.get("url"),
            "sha256": result.get("sha256"),
            "status": result.get("status"),
            "faults_extracted": result.get("faults_extracted"),
            "params_extracted": result.get("params_extracted"),
            "attempted_at": result.get("generated_at"),
        }
    )
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        _history_path(out_dir).write_text(
            json.dumps({"attempts": history}, indent=2), encoding="utf-8"
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not write history: %s", exc)


def pick_target(
    target_id: str | None,
    attempted: set[str] | None = None,
    gold: set[str] | None = None,
) -> dict[str, Any]:
    """Choose the target. Unseen-never-attempted-FIRST, in the deterministic
    ``SCOUT_TARGETS`` declaration order (that order IS the priority — Magnetek
    G+ Mini leads). NOT a modulo loop: once every eligible family has a completed
    evaluation, the scout FAILS LOUD rather than silently re-running a done family.

    - ``gold``: families with a gold set — skipped (grading one is no longer unseen).
    - ``attempted``: families with a completed (GRADED) run — skipped when auto-selecting.
    - ``target_id``: an explicit pin overrides selection (but still refuses a gold family);
      a pin may re-run an already-attempted family on purpose (manual re-eval).

    Intended cadence consequence (by design): an EMPTY extract still returns
    ``GRADED``, so each family is evaluated **once** and its gap emailed once —
    the scout does NOT re-email a 0/0 result daily. Once every eligible family has
    been evaluated the scheduled run raises here (before the send path) and exits
    non-zero with **no email** — a loud "add a new family / land a dialect" signal,
    not silent repetition. Add families to ``SCOUT_TARGETS`` (or promote one to
    ``gold/``) to keep the daily cadence producing new evaluations.
    """
    gold = _gold_families() if gold is None else gold
    attempted = set() if attempted is None else attempted

    eligible = [t for t in SCOUT_TARGETS if t["pack_id"] not in gold]
    if not eligible:
        raise SystemExit("scout: every configured target is already in gold/ — add a new family")

    if target_id:
        for t in SCOUT_TARGETS:
            if t["pack_id"] == target_id:
                if t["pack_id"] in gold:
                    raise SystemExit(f"scout: {target_id} is in gold/ — not an unseen test")
                return t
        raise SystemExit(
            f"scout: unknown --target {target_id}; known: {[t['pack_id'] for t in SCOUT_TARGETS]}"
        )

    for t in eligible:  # deterministic: first declared, never-attempted family
        if t["pack_id"] not in attempted:
            return t

    raise SystemExit(
        "scout: every eligible family already has a completed evaluation "
        f"({sorted(attempted)}). Add a new family to SCOUT_TARGETS or promote one "
        "to gold/ — refusing to re-run a done family (use --target to force a re-eval)."
    )


def fetch_manual(url: str, dest: Path, timeout: float = 120.0) -> tuple[Path, str, int]:
    """Download the manual PDF. Returns (path, sha256, byte_len). Read-only w.r.t.
    the remote — a plain GET, no auth, no writes anywhere but ``dest``."""
    import httpx

    logger.info("fetching manual: %s", url)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.content
    ctype = resp.headers.get("content-type", "")
    if b"%PDF" not in data[:1024] and "pdf" not in ctype.lower():
        raise ValueError(f"fetched content is not a PDF (content-type={ctype!r}, {len(data)} bytes)")
    dest.write_bytes(data)
    return dest, _sha256_bytes(data), len(data)


def build_pack(fragment: dict[str, Any], target: dict[str, Any], provenance_note: str) -> dict[str, Any]:
    """Assemble the extractor fragment into a schema-valid v2 pack.json for an
    arbitrary family. Mirrors ``generate_pf525_pack._build_pack`` but takes the
    family/nameplate metadata as parameters instead of hard-coding PowerFlex 525.
    The blocks a manual cannot supply (envelope/knowledge/live decode maps) stay
    honestly empty — precision over invented completeness.
    """
    fault_codes = fragment.get("fault_codes", {})
    fault_entries = fragment.get("fault_entries", [])
    fault_citations = fragment.get("fault_citations", [])
    parameters = fragment.get("parameters", [])

    sources = [
        {"doc": c["doc"], "page": str(c["page"]), "excerpt": c["excerpt"]}
        for c in fault_citations
    ]

    pack: dict[str, Any] = {
        "pack_id": target["pack_id"],
        "schema_version": 2,
        "family": {
            "manufacturer": target["manufacturer"],
            "series": target["series"],
            "aliases": list(target["aliases"]),
        },
        "nameplate": {"match_keywords": list(target["match_keywords"])},
        "live_decode": {
            "status_bits": {},
            "cmd_word": {},
            "fault_codes": fault_codes,
            "registers": {},
        },
        "envelope": {},
        "knowledge": {"scout_provenance": provenance_note},
        "provenance": {
            "items": {
                "live_decode.fault_codes": "manual_cited",
                "parameters": "manual_cited",
            },
            "sources": sources,
        },
        "parameters": parameters,
        "keypad_navigation": [],
    }
    if fault_entries:
        # Candidate-layer ONLY (Run B, Magnetek mnemonic dialect): string
        # fault identifiers the runtime's dict[int,str] fault_codes cannot
        # hold. The loader tolerates the extra key; no runtime consumes it —
        # this is the preserved evidence for the Run C schema decision.
        pack["fault_entries"] = fault_entries
        pack["provenance"]["items"]["fault_entries"] = "manual_cited"

    missing = set(_REQUIRED_TOP_LEVEL_KEYS) - pack.keys()
    if missing:
        raise RuntimeError(f"assembled pack missing keys {sorted(missing)}")
    return pack


def run_pipeline(target: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """Fetch -> extract -> assemble -> grade. Returns an evaluation dict with the
    grade report (or an honest failure record). Never raises for an expected
    fetch/parse miss — those become the evaluation."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    result: dict[str, Any] = {
        "target": target["pack_id"],
        "series": target["series"],
        "manufacturer": target["manufacturer"],
        "source_url": target["url"],
        "generated_at": ts,
        "status": "unknown",
    }

    pdf_path = workdir / f"{target['pack_id']}.pdf"
    try:
        t0 = time.monotonic()
        _, sha256, nbytes = fetch_manual(target["url"], pdf_path)
        result["fetch_ok"] = True
        result["sha256"] = sha256
        result["manual_bytes"] = nbytes
        result["fetch_secs"] = round(time.monotonic() - t0, 1)
    except Exception as exc:
        result["status"] = "FETCH_FAILURE"
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.warning("fetch failed: %s", result["error"])
        return result

    # Extract — whole-document scan (unseen manual: page ranges are unknown).
    try:
        t0 = time.monotonic()
        fragment = extractor.extract(pdf_path, doc=target["doc_label"])
        result["extract_secs"] = round(time.monotonic() - t0, 1)
        result["faults_extracted"] = len(fragment.get("fault_codes", {}))
        result["params_extracted"] = len(fragment.get("parameters", []))
    except Exception as exc:
        result["status"] = "EXTRACT_FAILURE"
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.warning("extract failed: %s", result["error"])
        return result

    # Assemble a staged candidate + grade it (gold-independent for a new family).
    provenance_note = (
        f"scout {ts}: {target['url']} sha256={result['sha256'][:12]} "
        f"({result['manual_bytes']} bytes); whole-doc extract"
    )
    packs_dir = workdir / "candidates"
    pack_dir = packs_dir / target["pack_id"]
    pack_dir.mkdir(parents=True, exist_ok=True)
    try:
        pack = build_pack(fragment, target, provenance_note)
        (pack_dir / "pack.json").write_text(json.dumps(pack, indent=2), encoding="utf-8")
    except Exception as exc:
        result["status"] = "ASSEMBLE_FAILURE"
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.warning("assemble failed: %s", result["error"])
        return result

    out_dir = workdir / "grading_out"
    # The grading harness uses bare sibling imports (from cite_check import ...),
    # so it must run as a script (its own dir on sys.path[0]), not be imported.
    try:
        proc = subprocess.run(
            [
                sys.executable, str(_GRADER),
                "--pack", target["pack_id"],
                "--manual", str(pdf_path),
                "--packs-dir", str(packs_dir),
                "--out", str(out_dir),
                "--generated-at", ts,
            ],
            capture_output=True, text=True, timeout=600,
        )
        report_path = out_dir / "scientific_report.json"
        if report_path.is_file():
            result["status"] = "GRADED"
            result["report"] = json.loads(report_path.read_text(encoding="utf-8"))
            result["grader_promotable"] = proc.returncode == 0
        else:
            result["status"] = "GRADE_FAILURE"
            result["error"] = (proc.stderr or proc.stdout or "no report written")[-500:]
            logger.warning("grade produced no report: %s", result["error"])
    except Exception as exc:
        result["status"] = "GRADE_FAILURE"
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.warning("grade failed: %s", result["error"])
    return result


# --- Evaluation rendering --------------------------------------------------


def _fmt_report_lines(result: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    r = result.get("report")
    if not r:
        return lines
    lines.append(f"Grade: {r.get('grade')} ({r.get('overall_score')}/100)"
                 + (" — INCOMPLETE" if r.get("incomplete") else ""))
    lines.append(f"Promotion: {r.get('promotion_recommendation')}")
    layers = r.get("categories") or r.get("layers") or {}
    if isinstance(layers, dict):
        for name, cat in layers.items():
            score = cat.get("score") if isinstance(cat, dict) else cat
            lines.append(f"  - {name}: {score}")
    for cf in r.get("critical_failures", []) or []:
        lines.append(f"  ! critical: {cf}")
    return lines


def _headline(result: dict[str, Any]) -> str:
    """The honest one-line verdict. An *empty* pack (0 entries) that trivially
    passes schema/domain must NOT be sold as a good grade — the recall gap is the
    finding, so it leads."""
    status = result["status"]
    if status != "GRADED" or not result.get("report"):
        return status
    n = result.get("faults_extracted", 0) + result.get("params_extracted", 0)
    if n == 0:
        return "EMPTY — 0 entries extracted (generalization gap)"
    r = result["report"]
    return f"{r.get('grade')} {r.get('overall_score')}/100"


def render_evaluation(result: dict[str, Any]) -> tuple[str, str, str]:
    """Return (subject, plain_text, html) for the evaluation."""
    fam = result["series"]
    status = result["status"]
    grade = _headline(result)
    subject = f"Drive Commander eval — {fam} — {grade}"

    lines = [
        f"Drive Commander self-eval scout — {result['generated_at']}",
        "",
        f"Drive family : {result['manufacturer']} {fam}  (pack_id: {result['target']})",
        f"Source        : {result['source_url']}",
    ]
    if result.get("sha256"):
        lines.append(f"Manual        : {result['manual_bytes']} bytes  sha256={result['sha256'][:16]}…")
    if result.get("fetch_secs") is not None:
        lines.append(f"Fetch         : {result['fetch_secs']}s")
    if result.get("extract_secs") is not None:
        lines.append(
            f"Extracted     : {result.get('faults_extracted', 0)} fault codes, "
            f"{result.get('params_extracted', 0)} parameters  ({result['extract_secs']}s)"
        )
    lines.append(f"Status        : {status}")
    if result.get("error"):
        lines.append(f"Error         : {result['error']}")
    lines.append("")
    lines.extend(_fmt_report_lines(result))
    lines.append("")
    n_entries = result.get("faults_extracted", 0) + result.get("params_extracted", 0)
    if status == "GRADED" and n_entries == 0:
        lines.append(
            "Interpretation: the extractor recovered NOTHING from this manual's layout. The numeric "
            "grade only reflects schema+domain checks on an empty pack — it is NOT a quality signal. "
            "The finding is a real generalization gap: the position-aware fault/parameter parser is "
            "tuned to the PowerFlex 520-series table shapes and does not yet recognise this family's "
            "tables. Next step: capture this manual's fault/parameter page ranges + header shape and "
            "extend the parser (or add a gold set) — same play as GS10."
        )
        lines.append("")
    lines.append("Note: gold-independent grade (unseen family — schema + cite-integrity + domain "
                 "layers only). Staged candidate; nothing promoted to the runtime resolver.")
    text = "\n".join(lines)
    html = "<pre style=\"font-family:ui-monospace,Menlo,monospace;font-size:13px\">" + \
        text.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"
    return subject, text, html


def send_email(subject: str, html: str, api_key: str, to_addr: str) -> bool:
    if not api_key:
        logger.warning("no RESEND_API_KEY — cannot send email")
        return False
    import httpx

    try:
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"from": RESEND_FROM, "to": [to_addr], "subject": subject, "html": html},
            )
            resp.raise_for_status()
        logger.info("evaluation email sent to %s", to_addr)
        return True
    except Exception as exc:
        logger.warning("email send failed: %s", exc)
        return False


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", default=None, help="pin a target pack_id (forces a re-eval even if already attempted)")
    p.add_argument(
        "--run-index", type=int, default=0,
        help="DEPRECATED / ignored — selection is now history-driven "
        "(never-attempted-first). Accepted for back-compat with old schedulers.",
    )
    g = p.add_mutually_exclusive_group()
    g.add_argument("--send", action="store_true", help="send the real evaluation email via RESEND")
    g.add_argument("--dry-run", action="store_true", help="write the evaluation to a file, do NOT email (default)")
    p.add_argument("--out", default=None, help="output dir for the evaluation artifact")
    p.add_argument("--to", default=None, help="override recipient (default MORNING_REPORT_EMAIL or the built-in)")
    p.add_argument("--keep-workdir", action="store_true", help="don't delete the scratch workdir (debug)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    import os

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)

    out_dir = Path(args.out) if args.out else _REPO_ROOT / "dogfood-output" / "drive-commander-scout"
    out_dir.mkdir(parents=True, exist_ok=True)

    # History-driven selection: never-attempted-first, fail loud when exhausted.
    history = _load_history(out_dir)
    target = pick_target(args.target, attempted=_graded_families(history))

    tmp = Path(tempfile.mkdtemp(prefix="dc-scout-"))
    try:
        result = run_pipeline(target, tmp)
    finally:
        if not args.keep_workdir:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)

    record_attempt(out_dir, target, result)

    subject, text, html = render_evaluation(result)

    artifact = out_dir / f"eval-{result['target']}-{result['generated_at']}.md"
    artifact.write_text(f"# {subject}\n\n```\n{text}\n```\n", encoding="utf-8")
    (out_dir / "latest-eval.md").write_text(f"# {subject}\n\n```\n{text}\n```\n", encoding="utf-8")
    logger.info("evaluation artifact: %s", artifact)
    print(subject)
    print(text)

    if args.send:
        api_key = os.getenv("RESEND_API_KEY", "")
        to_addr = args.to or os.getenv("MORNING_REPORT_EMAIL", RESEND_TO_DEFAULT)
        ok = send_email(subject, html, api_key, to_addr)
        if not ok:
            logger.warning("email not sent (see above); artifact still written")

    # Exit non-zero only on a hard pipeline failure so a scheduler/CI can alert;
    # a low-recall-but-graded run is a success (the honest finding is the point).
    return 0 if result["status"] == "GRADED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
