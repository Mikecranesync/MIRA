"""One-command Phase 4 gate — the MQTT nervous system.

    python mqtt_uns/run_phase4.py        # from the worktree root
    make mqtt-phase4                       # convenience wrapper

Proves: a deterministic event can travel through MQTT (UNS topic) and produce the EXACT same
evidence-backed answer card that exists offline. MQTT is only transport; the brain is unchanged.

Steps (exits NONZERO on any failure):
  1. run Phase 0 -> 1 -> 2 -> 3 (via the Phase 3 gate; regenerates the offline answer card)
  2. build the brain (context model + evidence graph + history)
  3. flagship round trip: event -> publish (UNS topic) -> subscribe -> explain -> answer card;
     the MQTT card must equal BOTH the freshly-computed offline card AND the committed Phase 3 card
  4. contradiction round trip (counts still increasing -> confidence drops, survives transport)
  5. replay validation: hundreds of replays across fault types/assets/contradiction cases
  6. message determinism + Phase 4 pytest

Fails on: MQTT transport failures, answer-card mismatches, unsupported claims, missing citations,
non-determinism, evidence-graph violations.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # mqtt_uns/
_ROOT = _HERE.parent
_EG = _ROOT / "evidence_graph"
for _p in (str(_HERE), str(_EG), str(_ROOT / "causality"), str(_ROOT / "factory_context"),
           str(_ROOT / "discovery_corpus" / "scripts"), str(_ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import answer_card as ac  # noqa: E402  (evidence_graph.answer_card -> REQUIRED_SECTIONS)
import broker as bk  # noqa: E402
import components as comp  # noqa: E402
import event_bridge as eb  # noqa: E402
import mqtt_reports as mr  # noqa: E402
import publisher as pub_mod  # noqa: E402
import replay as rp  # noqa: E402
import subscriber as sub_mod  # noqa: E402


def _utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _round_trip(graph, history, event):
    """event -> publish -> subscribe -> received event -> explanation + card."""
    transport = bk.InMemoryBroker()
    sub = sub_mod.Subscriber(transport, "#")
    pub = pub_mod.Publisher(transport)
    topic, payload, delivered = pub.publish_event(event)
    if delivered != 1 or len(sub.received) != 1:
        return None, None, topic, payload, None
    _, received = sub.received[0]
    exp, mqtt_card = eb.explain_event(graph, history, received)
    return exp, mqtt_card, topic, payload, received


def main() -> int:
    _utf8_stdout()
    print("== Phase 4 gate (MQTT nervous system) ==\n[1/6] running Phase 3 gate (-> 2 -> 1 -> 0) ...")
    rc = subprocess.call([sys.executable, str(_EG / "run_phase3.py")])
    if rc != 0:
        print("\nPHASE 4: FAIL — Phase 3 gate not green (rc=%d)" % rc)
        return 1

    print("\n[2/6] building the brain ...")
    cmodel, graph, history = eb.build_brain()
    conv = next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")
    reports_dir = _HERE / "reports"
    reports_dir.mkdir(exist_ok=True)
    failures = []

    # 3. flagship round trip
    print("[3/6] flagship round trip: photoeye event over MQTT ...")
    event = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)
    _, offline_card = eb.explain_event(graph, history, event)
    exp, mqtt_card, topic, payload, received = _round_trip(graph, history, event)
    if mqtt_card is None:
        failures.append("flagship: MQTT transport failed (no delivery)")
    else:
        (reports_dir / "phase4_mqtt_report.md").write_text(
            mr.render_round_trip(received, topic, payload, sub_received_payload(payload), offline_card, mqtt_card) + "\n",
            encoding="utf-8")
        (reports_dir / "phase4_mqtt_report.json").write_text(
            json.dumps(mr.round_trip_dict(received, topic, payload, payload, mqtt_card == offline_card),
                       indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("  topic: %s" % topic)
        if mqtt_card != offline_card:
            failures.append("flagship: MQTT answer card != offline answer card")
        # cross-phase: must match the committed Phase 3 offline card byte-for-byte
        p3 = _EG / "reports" / "phase3_answer_card.md"
        if p3.exists() and p3.read_text(encoding="utf-8").rstrip("\n") != mqtt_card.rstrip("\n"):
            failures.append("flagship: MQTT card != committed Phase 3 answer card")
        miss = [s for s in ac.REQUIRED_SECTIONS if s not in mqtt_card]
        if miss:
            failures.append("flagship MQTT card missing sections: %s" % miss)

    # 4. contradiction round trip
    print("[4/6] contradiction round trip ...")
    ev_c = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path, conflicting=True)
    _, off_c = eb.explain_event(graph, history, ev_c)
    exp_c, mqtt_c, _, _, _ = _round_trip(graph, history, ev_c)
    if mqtt_c != off_c:
        failures.append("contradiction: MQTT card != offline card")
    elif "lowered by contradicting evidence" not in mqtt_c:
        failures.append("contradiction: confidence did not drop after transport")

    # 5. replay validation
    print("[5/6] replay validation (hundreds of events) ...")
    m = rp.run_replay(cmodel, graph, history, repeats=12)
    (reports_dir / "phase4_replay_validation.md").write_text(rp.render_replay_report(m) + "\n", encoding="utf-8")
    (reports_dir / "phase4_replay_validation.json").write_text(
        json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("  %d replays | match %s%% | determinism %s%% | citations %s%% | cause %s%%"
          % (m["total_replays"], m["mqtt_match_pct"], m["determinism_pct"],
             m["citation_complete_pct"], m["cause_accuracy_pct"]))
    if m["total_replays"] < 200:
        failures.append("replay: fewer than 200 replays (%d)" % m["total_replays"])
    for key, label in (("mqtt_match_pct", "answer-card consistency"), ("determinism_pct", "determinism"),
                       ("citation_complete_pct", "citation completeness")):
        if m[key] != 100.0:
            failures.append("replay: %s is %s%% (must be 100%%)" % (label, m[key]))
    if m["transport_failures"] or m["answer_card_mismatches"]:
        failures.append("replay: %d transport failures, %d mismatches"
                        % (m["transport_failures"], m["answer_card_mismatches"]))

    # 6. message determinism + tests
    print("[6/6] message determinism + pytest ...")
    if event.to_json() != eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path).to_json():
        failures.append("event serialization is non-deterministic")
    rc2 = subprocess.call([sys.executable, "-m", "pytest", str(_HERE / "tests"), "-q"])
    if rc2 != 0:
        failures.append("pytest exit %d" % rc2)

    if failures:
        print("\nPHASE 4: FAIL")
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nPHASE 4: OK (event crossed MQTT and produced the identical evidence-backed answer card; "
          "%d replays 100%% consistent + deterministic; tests green)" % m["total_replays"])
    return 0


def sub_received_payload(published_payload: str) -> str:
    # loopback transport delivers the payload unchanged; kept explicit for the report's intent.
    return published_payload


if __name__ == "__main__":
    raise SystemExit(main())
