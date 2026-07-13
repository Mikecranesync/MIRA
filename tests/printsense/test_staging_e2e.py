"""LAYER 3 — ROUTE-AWARE live Telegram staging E2E (pre-release, gated).

Runs the REAL path through @Mira_stagong_bot via a Telethon USER account, handling
each route differently (see printsense.harness.telethon_e2e):
  * electrical print  → await the PrintSense reply, validate, send `map`, validate the map.
  * nameplate         → await the nameplate/Drive-Commander reply, assert it did NOT
                        route as a print, and send NO `map`.
  * degraded print    → degrade the image first; assert uncertainty discipline (no
                        fabricated forbidden designation), route/reply lenient.

Records distinguish a ROUTING failure from a REPLY-DETECTION (timeout) failure.
Skips unless the Telethon session is present — so it never runs in normal CI.
Reports use case IDs, not sensitive original filenames; the session is never recorded.
"""

import json
import os
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from printsense import render  # noqa: E402
from printsense.harness import corpus  # noqa: E402
from printsense.harness import telethon_e2e as tg  # noqa: E402

_HAVE_TELETHON = pytest.importorskip("telethon", reason="telethon not installed") is not None
_RUN = tg.creds_available()
_REPORT_DIR = Path(os.getenv("PRINTSENSE_REPORT_DIR", "printsense/benchmarks/_e2e_out"))

E2E_CASES = corpus.cases()
IDS = [c.name for c in E2E_CASES]


def _mode(case) -> str:
    if case.routing == "nameplate":
        return tg.MODE_NAMEPLATE
    if case.routing == "electrical_print":
        return tg.MODE_PRINT
    return tg.MODE_GENERIC


def _record(rec: dict) -> None:
    _REPORT_DIR.mkdir(parents=True, exist_ok=True)
    with (_REPORT_DIR / f"{rec['case']}.e2e.json").open("w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=2, ensure_ascii=False)


@pytest.mark.skipif(not _RUN, reason="Telethon session absent — set TELEGRAM_TEST_SESSION (pre-release only)")
@pytest.mark.parametrize("case", E2E_CASES, ids=IDS)
def test_staging_e2e(case):
    img = case.image_bytes_verified()
    if img is None:
        pytest.skip(f"{case.name}: corpus image not available (fetch the protected corpus first)")

    # DEGRADED case: actually degrade the input so the run tests uncertainty discipline.
    if case.degraded:
        from printsense.harness import metamorphic as _M

        img = _M.downscale(1100)(_M.blur(1.2)(img))

    mode = _mode(case)
    caption = "what drive is this?" if case.routing == "nameplate" else "explain this print"
    result = tg.send_image(img, mode=mode, caption=caption)

    rec = {
        "case": case.name,  # a stable ID — never the sensitive original filename
        "routing_expected": case.routing,
        "mode": result.mode,
        "degraded_input": case.degraded,
        "got_reply": result.got_reply,
        "timed_out": result.timed_out,
        "routed_as": result.routed_as,
        "routed_as_print": result.routed_as_print,
        "map_sent": result.map_sent,
        "default_latency_s": result.default_latency_s,
        "map_latency_s": result.map_latency_s,
        "default_reply": result.default_reply,
        "map_reply": result.map_reply,
        "unresolved_mentioned": "Couldn't confirm" in result.default_reply,
        "confident_misreads": None,
    }
    _record(rec)  # persist evidence even if an assertion below fails

    # REPLY-DETECTION failure is distinct from a routing failure.
    assert result.got_reply, f"{case.name}: no substantive reply within timeout (reply-detection failure, not routing)"

    if case.routing == "nameplate":
        # A nameplate must route to the nameplate/Drive-Commander flow, NOT the print
        # interpreter, and must NOT be followed by a `map` (that route has no map).
        assert not result.routed_as_print, f"{case.name}: nameplate wrongly routed as an electrical print"
        assert not result.map_sent, f"{case.name}: `map` must NOT be sent on the nameplate route"
        rec["routing_ok"] = True

    elif case.degraded:
        # Uncertainty discipline: it may answer with caveats OR decline, but must NOT
        # fabricate a forbidden exact designation.
        both = (result.default_reply + " " + result.map_reply).upper()
        leaked = [t for t in case.forbid_tokens if t.upper() in both]
        rec["degraded_leaked"] = leaked
        rec["routing_ok"] = not leaked
        assert not leaked, f"{case.name}: degraded reply fabricated {leaked}"

    else:
        # PRINT (incl. the ROTATED case): must route to the interpreter and require BOTH
        # the plain-English default AND the detailed map.
        assert result.routed_as_print, f"{case.name}: expected the electrical-print route, got '{result.routed_as}'"
        assert result.map_sent and result.map_reply, f"{case.name}: print route requires a `map` follow-up reply"
        rec["routing_ok"] = True
        reply = result.default_reply
        assert "external" not in reply.lower(), f"{case.name}: live reply used vague 'external'"
        assert render._CLOSING in reply, f"{case.name}: live reply missing the measurement closing"
        assert 'Reply "map"' in reply or "map" in reply.lower(), f"{case.name}: no map affordance in the default reply"
        for tok in case.forbid_tokens:  # exact designations live in the map, never leaked/invented
            assert tok.upper() not in reply.upper(), f"{case.name}: default reply leaked forbidden {tok}"

        rubric = case.rubric()
        if rubric is not None:
            from printsense import grader, interpret

            g = interpret.interpret_print([(img, "image/jpeg")], preprocess=True)
            gr = grader.grade(g.model_dump(), rubric)
            rec["confident_misreads"] = gr["confident_misreads"]
            rec["grade"] = f"{gr['overall']}/{gr['letter']}"
            rec["unresolved_findings"] = [u.item for u in g.unresolved]
            _record(rec)
            assert gr["confident_misreads"] == 0, f"{case.name}: {gr['confident_misreads']} confident misreads"

    _record(rec)
