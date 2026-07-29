"""PrintSense Phase-1 capability bench — deterministic, hermetic, no-spend.

Grades the deterministic PrintSense surface per-capability against the frozen
synthetic golden corpus (``golden_corpus.py``). NO LLM, NO network, NO OCR
binary, NO Doppler — pure functions over committed fixtures, so it runs
identically in CI, locally, and inside the Telegram bot container.

Doctrine (same as gates.py / system_bench.py):

* Deterministic wherever possible — exact match, precision/recall/F1,
  resolution-state correctness, convention accuracy, byte-stable output.
* A HARD FAILURE fails its case (and the whole bench) regardless of average
  scores. A judge — when one exists in later phases — may explain a failure,
  never clear one. Phase 1 has NO judge at all.
* One capability can never qualify another: every capability's score derives
  only from its own lane over its own cases.
* Truth is frozen: ``golden_corpus.truth_digest()`` must equal the committed
  ``golden_corpus.sha256`` or the whole run is a hard failure
  (``truth_tampered``).

Hard-failure classes implemented (Phase-1 deterministic set):
  invention              — claimed device/cable not in truth (set difference)
  known_misread_asserted — an OCR-confusable wrong form was asserted
  fabricated_destination — a resolved target_page not supplied by the index
  grid_ref_resolved      — a GRID_REF auto-resolved to a page
  contact_convention     — convention role disagrees with IEC-derived truth
  state_proof_missing    — a contact/coil claim without state_proof "never"
  refusal_violated       — an unreadable case produced any claim
  evidence_missing       — a claim without usable bbox evidence
  truth_tampered         — corpus truth no longer matches the frozen digest
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

from ..designations import detect_profile
from ..designations.contact_markings import classify as classify_cp
from ..xref_extractor import lex_page, resolve
from . import golden_corpus

BENCH_VERSION = "capability_bench_v1"

_ROOT = Path(__file__).resolve().parents[2]
_SHA_FILE = Path(__file__).resolve().parent / "golden_corpus.sha256"

# The committed synthetic corpus uses this fictional-device grammar. It is a
# CORPUS convention (sheets 9x, letter+2-digit ids, -W509x cables), not a
# general IEC parser — the designations package owns real decoding.
_DEVICE_RE = re.compile(r"^-9\d/[A-Z]\d{2}$")
_CABLE_RE = re.compile(r"^-W\d{4}$")

# Capabilities the bench grades deterministically in Phase 1. Anything else in
# capability_matrix.json is explicitly deferred — never silently "passed".
LANES = (
    "device_extraction",
    "contact_conventions",
    "state_proof_discipline",
    "cross_sheet_refs",
    "grid_refs",
    "cable_continuations",
    "profile_discrimination",
    "bbox_evidence",
    "missing_context",
    "next_page_recommendation",
    "unsupported_claim_resistance",
    "refusal_on_unreadable",
    "determinism",
)


# ---------------------------------------------------------------------------
# Deterministic extraction under test (the shared printsense surface)
# ---------------------------------------------------------------------------


def extract_case(case: dict) -> dict:
    """Run the deterministic extraction stack on one case's token stream."""
    tokens = case.get("tokens", [])
    candidates = lex_page(tokens, source_page=case["page"], page_width=case.get("page_width", 1400))
    records = resolve(candidates, case.get("page_index", {"sheets": {}, "anchors": {}}))
    devices = [
        {"tag": t["text"], "bbox": list(t["bbox"])} for t in tokens if _DEVICE_RE.match(t["text"])
    ]
    cables = [t["text"] for t in tokens if _CABLE_RE.match(t["text"])]
    profile = detect_profile(case.get("profile_samples", []), title_text=case.get("title_text", ""))
    return {"devices": devices, "cables": cables, "records": records, "profile": profile}


def recommend_next_pages(records: list[dict]) -> list[str]:
    """Pure next-page recommender: sheets a technician should photograph next —
    exactly the lexical sheet numbers of references that could not resolve
    because their target is absent. Never invents a page."""
    out = set()
    for r in records:
        if r.get("resolution") == "missing_target":
            sheet = r.get("target_sheet_lexical")
            if sheet:
                out.add(str(sheet))
    return sorted(out)


# ---------------------------------------------------------------------------
# Per-case grading
# ---------------------------------------------------------------------------


def _prf(claimed: set, expected: set) -> tuple[float, float, float]:
    tp = len(claimed & expected)
    p = tp / len(claimed) if claimed else (1.0 if not expected else 0.0)
    r = tp / len(expected) if expected else 1.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return round(p, 4), round(r, 4), round(f1, 4)


def _iou(a: list, b: list) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union else 0.0


def _xref_key(rec: dict) -> tuple:
    return (rec.get("pattern_class"), rec.get("resolution"), rec.get("target_page"))


def grade_case_lanes(case: dict, extraction: dict | None = None) -> dict:
    """Grade every lane for one case. Returns lanes + hard_failures."""
    if "tokens" not in case or "truth" not in case:
        return {
            "case_id": case.get("case_id", "?"),
            "status": "missing_input",
            "lanes": {},
            "hard_failures": [
                {
                    "class": "missing_input",
                    "detail": "case lacks tokens/truth — explicit non-result",
                }
            ],
        }

    truth = case["truth"]
    ex = extraction or extract_case(case)
    lanes: dict = {}
    hard: list[dict] = []

    # --- device extraction (P/R/F1, exact tags) + invention + misreads ---
    claimed_tags = {d["tag"] for d in ex["devices"]}
    expected_tags = {d["tag"] for d in truth["devices"]}
    p, r, f1 = _prf(claimed_tags, expected_tags)
    lanes["device_extraction"] = {"precision": p, "recall": r, "f1": f1}
    for tag in sorted(claimed_tags - expected_tags):
        hard.append({"class": "invention", "detail": f"invented device {tag}"})
    misreads = set(truth.get("known_misreads", []))
    for tag in sorted((claimed_tags | set(ex["cables"])) & misreads):
        hard.append(
            {
                "class": "known_misread_asserted",
                "detail": f"asserted OCR-confusable wrong form {tag}",
            }
        )

    # --- contact conventions + state_proof (against IEC-derived truth) ---
    conv_total, conv_ok = 0, 0
    for term in truth.get("terminals", []):
        conv_total += 1
        res = classify_cp(term["cp"], parent_class=term.get("parent_class"))
        conv = (res or {}).get("convention", {})
        role = conv.get("role")
        if role == term["convention_role"]:
            conv_ok += 1
        else:
            hard.append(
                {
                    "class": "contact_convention",
                    "detail": (
                        f"{term['cp']} on class {term.get('parent_class')}: "
                        f"derived {role!r}, truth {term['convention_role']!r}"
                    ),
                }
            )
        if conv.get("state_proof") != "never":
            hard.append(
                {
                    "class": "state_proof_missing",
                    "detail": f"{term['cp']} lacks state_proof='never'",
                }
            )
    lanes["contact_conventions"] = {
        "accuracy": round(conv_ok / conv_total, 4) if conv_total else 1.0,
        "graded": conv_total,
    }
    lanes["state_proof_discipline"] = {
        "violations": sum(1 for h in hard if h["class"] == "state_proof_missing")
    }

    # --- cross-sheet refs: edge-key F1 + resolution-state correctness ---
    truth_xrefs = truth.get("xrefs", [])
    rec_keys = {_xref_key(r) for r in ex["records"]}
    want_keys = set()
    matched = 0
    for tx in truth_xrefs:
        key = (tx["pattern_class"], tx["resolution"], tx.get("target_page"))
        want_keys.add(key)
        if key in rec_keys:
            matched += 1
        else:
            hard.append(
                {
                    "class": "missing_context"
                    if tx["resolution"] != "resolved"
                    else "cross_sheet_refs",
                    "detail": f"expected {key} not produced",
                }
            )
    xp, xr, xf1 = (
        _prf(rec_keys & want_keys | (rec_keys - want_keys), want_keys)
        if truth_xrefs or ex["records"]
        else (1.0, 1.0, 1.0)
    )
    lanes["cross_sheet_refs"] = {"expected": len(want_keys), "matched": matched, "f1": xf1}
    valid_targets = set(case.get("page_index", {}).get("sheets", {}).values())
    for rec in ex["records"]:
        if rec.get("resolution") == "resolved" and rec.get("target_page") not in valid_targets:
            hard.append(
                {
                    "class": "fabricated_destination",
                    "detail": f"{rec.get('raw_reference')!r} -> "
                    f"{rec.get('target_page')!r} not in index",
                }
            )
        if rec.get("pattern_class") == "GRID_REF" and rec.get("resolution") == "resolved":
            hard.append(
                {
                    "class": "grid_ref_resolved",
                    "detail": f"grid ref {rec.get('raw_reference')!r} auto-resolved",
                }
            )

    lanes["grid_refs"] = {
        "expected": len(truth.get("grid_refs", [])),
        "found": sum(1 for r in ex["records"] if r.get("pattern_class") == "GRID_REF"),
    }

    # --- cable continuations ---
    cp_, cr_, cf1 = _prf(set(ex["cables"]), set(truth.get("cables", [])))
    lanes["cable_continuations"] = {"f1": cf1}

    # --- profile discrimination ---
    prof = ex["profile"]
    want_prof = truth.get("expected_profile", {})
    sel_ok = prof.get("selected_profile") in want_prof.get(
        "selected_in", [prof.get("selected_profile")]
    )
    conf_ok = sorted(prof.get("conflicts", [])) == sorted(want_prof.get("conflicts", []))
    lanes["profile_discrimination"] = {"selected_ok": sel_ok, "conflicts_ok": conf_ok}
    if not sel_ok or not conf_ok:
        hard.append(
            {
                "class": "profile_discrimination",
                "detail": f"selected={prof.get('selected_profile')!r} "
                f"conflicts={prof.get('conflicts')!r}",
            }
        )

    # --- bbox evidence (exact token boxes; IoU kept for image-based phases) ---
    ev_total, ev_ok = 0, 0
    truth_dev_boxes = {d["tag"]: d.get("bbox") for d in truth["devices"]}
    for d in ex["devices"]:
        ev_total += 1
        tb = truth_dev_boxes.get(d["tag"])
        if tb and _iou(d["bbox"], tb) >= 0.5:
            ev_ok += 1
        elif d["tag"] in truth_dev_boxes:
            hard.append(
                {
                    "class": "evidence_missing",
                    "detail": f"device {d['tag']} bbox {d['bbox']} vs truth {tb}",
                }
            )
    for rec in ex["records"]:
        if not rec.get("evidence_bbox"):
            hard.append(
                {
                    "class": "evidence_missing",
                    "detail": f"xref {rec.get('raw_reference')!r} has no evidence_bbox",
                }
            )
    lanes["bbox_evidence"] = {"checked": ev_total, "ok": ev_ok}

    # --- missing context + next-page recommendation ---
    lanes["missing_context"] = {
        "declared": sum(
            1
            for r in ex["records"]
            if r.get("resolution") in ("missing_target", "ambiguous", "contradictory")
        )
    }
    recommended = recommend_next_pages(ex["records"])
    want_pages = list(truth.get("expected_next_pages", []))
    lanes["next_page_recommendation"] = {
        "recommended": recommended,
        "expected": want_pages,
        "ok": recommended == want_pages,
    }
    if recommended != want_pages:
        hard.append(
            {
                "class": "next_page_recommendation",
                "detail": f"recommended {recommended} != expected {want_pages}",
            }
        )

    # --- refusal on unreadable ---
    if truth.get("expected_refusal"):
        claims = len(ex["devices"]) + len(ex["records"]) + len(ex["cables"])
        lanes["refusal_on_unreadable"] = {"claims": claims, "ok": claims == 0}
        if claims:
            hard.append(
                {
                    "class": "refusal_violated",
                    "detail": f"unreadable case produced {claims} claim(s)",
                }
            )

    # --- unsupported-claim resistance (roll-up of the invention family) ---
    lanes["unsupported_claim_resistance"] = {
        "violations": sum(
            1
            for h in hard
            if h["class"]
            in (
                "invention",
                "fabricated_destination",
                "known_misread_asserted",
                "grid_ref_resolved",
            )
        )
    }

    status = "hard_fail" if hard else "pass"
    return {"case_id": case["case_id"], "status": status, "lanes": lanes, "hard_failures": hard}


# ---------------------------------------------------------------------------
# Corpus run + envelope
# ---------------------------------------------------------------------------


def _version() -> str:
    for cand in (_ROOT / "VERSION", Path("/app/VERSION")):
        try:
            return cand.read_text(encoding="utf-8").strip()
        except OSError:
            continue
    return "unknown"


def frozen_digest_ok(cases: list[dict] | None = None) -> bool:
    """True when the truth of the cases being run matches the committed
    freeze digest — running edited truth under enforcement is tampering."""
    try:
        committed = _SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return committed == golden_corpus.truth_digest(cases)


def run_corpus(cases: list[dict] | None = None, enforce_freeze: bool = True) -> dict:
    cases = cases if cases is not None else golden_corpus.CASES
    results = [grade_case_lanes(c) for c in cases]

    # determinism lane: the whole run must be byte-stable
    second = [grade_case_lanes(c) for c in cases]
    deterministic = _stable(results) == _stable(second)

    hard: list[dict] = []
    if enforce_freeze and not frozen_digest_ok(cases):
        hard.append(
            {
                "class": "truth_tampered",
                "case_id": "(corpus)",
                "detail": "golden corpus truth digest does not match the "
                "committed golden_corpus.sha256",
            }
        )
    if not deterministic:
        hard.append(
            {
                "class": "nondeterministic_output",
                "case_id": "(corpus)",
                "detail": "repeated run was not byte-identical",
            }
        )
    for res in results:
        for h in res["hard_failures"]:
            hard.append({**h, "case_id": res["case_id"]})

    capabilities: dict = {}
    for lane in LANES:
        seen = [r["lanes"][lane] for r in results if lane in r["lanes"]]
        lane_hard = [
            h
            for h in hard
            if h["class"] == lane
            or (
                lane == "unsupported_claim_resistance"
                and h["class"]
                in (
                    "invention",
                    "fabricated_destination",
                    "known_misread_asserted",
                    "grid_ref_resolved",
                )
            )
        ]
        capabilities[lane] = {
            "cases": len(seen),
            "hard_failures": len(lane_hard),
            "status": (
                "no_cases"
                if not seen and lane != "determinism"
                else "fail"
                if lane_hard
                else "pass"
            ),
        }
    capabilities["determinism"] = {
        "cases": len(cases),
        "hard_failures": 0 if deterministic else 1,
        "status": "pass" if deterministic else "fail",
    }

    passed = sum(1 for r in results if r["status"] == "pass")
    return {
        "bench_version": BENCH_VERSION,
        "corpus_version": golden_corpus.CORPUS_VERSION,
        "truth_digest": golden_corpus.truth_digest(cases if cases is not None else None),
        "version": _version(),
        "cases_total": len(results),
        "cases_passed": passed,
        "cases_failed": len(results) - passed,
        "hard_failures": hard,
        "capabilities": capabilities,
        "deterministic": deterministic,
        "results": results,
    }


def _stable(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def stable_envelope_json(envelope: dict) -> str:
    return _stable(envelope)


def render_report(envelope: dict) -> str:
    e = envelope
    L = [
        "# PrintSense capability bench — Phase 1 (deterministic, no-spend)",
        "",
        f"bench {e['bench_version']} | corpus {e['corpus_version']} | repo VERSION {e['version']}",
        f"cases: {e['cases_passed']}/{e['cases_total']} passed | "
        f"hard failures: {len(e['hard_failures'])} | "
        f"deterministic: {e['deterministic']}",
        "",
        "## Capabilities",
        "",
        "| capability | cases | hard failures | status |",
        "|---|---|---|---|",
    ]
    for name, cap in sorted(e["capabilities"].items()):
        L.append(f"| {name} | {cap['cases']} | {cap['hard_failures']} | {cap['status']} |")
    if e["hard_failures"]:
        L += ["", "## Hard failures", ""]
        L += [f"- `{h['case_id']}` **{h['class']}** — {h['detail']}" for h in e["hard_failures"]]
    L += ["", "## Cases", ""]
    L += [f"- {r['case_id']}: {r['status']}" for r in e["results"]]
    L.append("")
    return "\n".join(L)


def phone_summary(envelope: dict, frozen_gate: list[tuple] | None = None) -> str:
    e = envelope
    ok = not e["hard_failures"] and e["cases_failed"] == 0
    head = "PASS" if ok else "FAIL"
    parts = [
        f"PrintSense phase1: {head} — {e['cases_passed']}/{e['cases_total']} "
        f"cases, {len(e['hard_failures'])} hard failure(s), "
        f"deterministic={e['deterministic']}"
    ]
    if frozen_gate:
        bits = ", ".join(
            f"{name} {verdict}{'✓' if verdict == expected else '✗'}"
            for name, verdict, expected in frozen_gate
        )
        parts.append(f"frozen gate: {bits}")
    caps_fail = [n for n, c in sorted(envelope["capabilities"].items()) if c["status"] == "fail"]
    parts.append("failing capabilities: " + (", ".join(caps_fail) or "none"))
    parts.append(f"VERSION {e['version']} | {e['bench_version']}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Artifact self-audit — artifacts must be safe to hand to an admin phone.
# ---------------------------------------------------------------------------

_AUDIT_PATTERNS = (
    ("absolute_windows_path", re.compile(r"[A-Za-z]:\\[^\s\"']{2,}")),
    (
        "absolute_unix_path",
        re.compile(r"(?<![\w.])/(?:home|Users|data|tmp|var|opt|root)/[^\s\"']+"),
    ),
    (
        "secret_assignment",
        re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*[=:]\s*['\"]?[A-Za-z0-9+/_-]{16,}"),
    ),
    ("telegram_bot_token", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b")),
)


def audit_artifact(text: str) -> list[str]:
    """Return violation labels found in an artifact. Empty list == safe."""
    return [name for name, pat in _AUDIT_PATTERNS if pat.search(text)]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    env = run_corpus()
    report = render_report(env)
    out = io.StringIO()
    out.write(report)
    sys.stdout.write(
        out.getvalue().encode("cp1252", "replace").decode("cp1252")
        if sys.platform == "win32"
        else out.getvalue()
    )
    violations = audit_artifact(report) + audit_artifact(stable_envelope_json(env))
    if violations:
        print(f"\nARTIFACT SELF-AUDIT FAILED: {violations}")
        return 1
    if env["hard_failures"] or env["cases_failed"]:
        print(
            f"\nBENCH FAIL: {len(env['hard_failures'])} hard failure(s), "
            f"{env['cases_failed']} failing case(s)."
        )
        return 1
    print("\nBENCH PASS: all cases green, zero hard failures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
