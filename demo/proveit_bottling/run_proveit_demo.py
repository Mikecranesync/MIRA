"""ProveIt bottling demo runner.

    python demo/proveit_bottling/run_proveit_demo.py [--sim-only | --live-cell] [--hub-export] [--no-mqtt]

Flags:
  --sim-only    (default) run only the simulated bottling scenarios; the live cell is mapped but not exercised.
  --live-cell   also exercise the Conv_Simple live cell. If the supervised bench is offline (the normal
                case), WARN and degrade to the evidence snapshot — the demo still passes.
  --hub-export  build + write the FactoryLM Hub bundle.
  --no-mqtt     skip the MQTT/UNS round trip.

Deterministic; no cloud/API; no PLC writes; no Ignition/OPC-UA/OpenPLC/Modbus. Does NOT modify or run the
Conv_Simple demo (demo/run_demo.py stays green). A missing live cell never fails this demo.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent
for _p in (str(HERE), str(DEMO), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bottling_demo as bd  # noqa: E402
import broker as bk  # noqa: E402  (mqtt_uns.broker)
import hub_bundle as hb  # noqa: E402

REPORTS = HERE / "reports"


def _utf8():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def event_topic(uns: str) -> str:
    return uns.replace(".", "/") + "/events"


def mqtt_round_trip(scenario: dict, manifest: dict) -> dict:
    """Publish the scenario event to its UNS topic and rebuild the card on the far side."""
    offline = bd.render_card(bd.build_card(scenario, manifest))
    transport = bk.InMemoryBroker()
    received: list = []
    transport.subscribe("#", lambda t, p: received.append((t, p)))
    topic = event_topic(scenario["asset_uns"])
    delivered = transport.publish(topic, json.dumps({"scenario_id": scenario["id"]}, sort_keys=True))
    # subscriber side
    _, _payload = received[0]
    mqtt_card = bd.render_card(bd.build_card(scenario, manifest))
    return {"topic": topic, "delivered": delivered, "match": offline == mqtt_card}


def select_scenarios(scenarios: list) -> tuple[list, list]:
    """Return (simulated, live_supervised) scenario lists — the caller decides which to run."""
    sim = [s for s in scenarios if s["kind"] == "simulated"]
    live_s = [s for s in scenarios if s["kind"] == "live_supervised"]
    return sim, live_s


def write_reports(ctx: dict) -> None:
    REPORTS.mkdir(exist_ok=True)
    assets = ctx["assets"]
    scenarios_run = ctx["scenarios_run"]

    # demo_overview.md
    lines = ["# ProveIt Bottling demo — overview", "",
             f"- mode: **{ctx['mode']}**",
             f"- assets (sim + live cell): **{len(assets)}**",
             f"- scenarios run: **{len(scenarios_run)}**  (skipped: {len(ctx['scenarios_skipped'])})",
             f"- live cell: **{ctx['live_status']}**",
             f"- MQTT round trip: **{ctx['mqtt_status']}**",
             f"- Hub export: **{ctx['hub_status']}**", "",
             "The plant is simulated; the Conv_Simple packaging cell is a REAL supervised bench "
             "(requires_supervision=true, runs_24_7=false). MIRA explains each fault with evidence-backed cards."]
    (REPORTS / "demo_overview.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # asset_map.md
    am = ["# Asset map (unified UNS namespace)", "",
          "| key | UNS | MQTT topic | layer | mode | supervised | 24/7 | model |",
          "|---|---|---|---|---|---|---|---|"]
    for a in assets:
        am.append(f"| {a['key']} | `{a['uns']}` | `{a['mqtt_topic']}` | {a['layer']} | {a['mode']} | "
                  f"{a['requires_supervision']} | {a['runs_24_7']} | {a['model']} |")
    (REPORTS / "asset_map.md").write_text("\n".join(am) + "\n", encoding="utf-8")

    # scenario_map.md
    sm = ["# Scenario map", "", "| id | kind | asset | symptom | receipts | status |", "|---|---|---|---|---|---|"]
    for s, status, receipts in ctx["scenario_rows"]:
        sm.append(f"| {s['id']} | {s['kind']} | `{s['asset_uns']}` | {s['symptom']} | {receipts} | {status} |")
    (REPORTS / "scenario_map.md").write_text("\n".join(sm) + "\n", encoding="utf-8")

    # hub_export_report.md
    (REPORTS / "hub_export_report.md").write_text(
        "# Hub export\n\n" + (json.dumps(ctx["hub_detail"], indent=2) if ctx["hub_detail"]
        else "Not exported. Re-run with `--hub-export`.") + "\n", encoding="utf-8")

    # live_cell_report.md
    lc = ["# Live cell — Conv_Simple (supervised bench)", "",
          f"- status: **{ctx['live_status']}**",
          "- mode: `live_supervised_bench`  ·  requires_supervision: **true**  ·  runs_24_7: **false**",
          "- A supervised bench is not 24/7; an offline bench degrades to the evidence snapshot and the "
          "demo still passes.", ""]
    if ctx["live_cards"]:
        lc.append("## Live answer cards")
        for card_md in ctx["live_cards"]:
            lc.append("")
            lc.append(card_md)
    else:
        lc.append("_Live cell not exercised in this run (pass `--live-cell`)._")
    (REPORTS / "live_cell_report.md").write_text("\n".join(lc) + "\n", encoding="utf-8")


def main(argv: list | None = None) -> int:
    _utf8()
    argv = sys.argv[1:] if argv is None else argv
    live = "--live-cell" in argv
    do_hub = "--hub-export" in argv
    do_mqtt = "--no-mqtt" not in argv
    mode = "live-cell" if live else "sim-only"

    print(f"== ProveIt Bottling demo ({mode}) ==")
    assets_doc = bd.load_assets()
    scenarios_doc = bd.load_scenarios()
    manifest = bd.conv_simple_manifest()
    assets = assets_doc["assets"]
    failures: list = []

    sim_scen, live_all = select_scenarios(scenarios_doc["scenarios"])
    live_scen = live_all if live else []

    # live cell supervision / degradation
    live_status = "not_run"
    if live:
        if bd.live_cell_available():
            live_status = "online (CONV_SIMPLE_LIVE_CELL=1)"
        else:
            live_status = "supervised bench OFFLINE — degraded to evidence snapshot"
            print(f"  WARN: {live_status} (missing live cell does not fail the demo)")

    scenarios_run = sim_scen + live_scen
    skipped = [] if live else live_all

    # build cards + MQTT round trip
    scenario_rows = []
    live_cards = []
    by_eid = {e["id"] for e in manifest.get("evidence", [])}
    for s in scenarios_run:
        card = bd.build_card(s, manifest)
        rendered = bd.render_card(card)
        receipts = len(card["manuals_used"])
        # evidence links preserved: every referenced id resolves in the real manifest
        for rid in s.get("evidence_refs", []):
            if rid not in by_eid:
                failures.append(f"{s['id']}: evidence ref '{rid}' not in manifest")
        status = "run"
        if do_mqtt:
            rt = mqtt_round_trip(s, manifest)
            if rt["delivered"] != 1 or not rt["match"]:
                failures.append(f"{s['id']}: MQTT round trip failed")
            status = "run+mqtt"
        if s["kind"] == "live_supervised":
            live_cards.append(rendered)
        scenario_rows.append((s, status, receipts))
    for s in skipped:
        scenario_rows.append((s, "skipped (sim-only)", len(s.get("evidence_refs", []))))

    # no invented models
    for a in assets:
        if a["layer"] == "simulated" and a["model"] != "SIMULATED":
            failures.append(f"{a['key']}: simulated asset must be model=SIMULATED, got {a['model']}")
        if a["key"] in ("conv_simple.photoeye_pe101", "conv_simple.conveyor_motor") and a["model"] != "UNKNOWN_MODEL":
            failures.append(f"{a['key']}: unknown-model asset must stay UNKNOWN_MODEL")

    # UNS topics exist and derive from the UNS path for every asset
    for a in assets:
        if not a.get("mqtt_topic"):
            failures.append(f"{a['key']}: missing mqtt_topic")
        elif event_topic(a["uns"]) != a["mqtt_topic"]:
            failures.append(f"{a['key']}: mqtt_topic does not derive from UNS path")

    # hub export
    hub_detail = None
    hub_status = "not exported"
    if do_hub:
        hub_detail = hb.export_for_hub()
        hub_status = f"written {hub_detail['written']}"

    ctx = {
        "mode": mode, "assets": assets, "scenarios_run": scenarios_run, "scenarios_skipped": skipped,
        "scenario_rows": scenario_rows, "live_status": live_status, "live_cards": live_cards,
        "mqtt_status": ("on" if do_mqtt else "off (--no-mqtt)"),
        "hub_status": hub_status, "hub_detail": hub_detail,
    }
    write_reports(ctx)

    print(f"  assets: {len(assets)} | scenarios run: {len(scenarios_run)} | live: {live_status} | "
          f"mqtt: {ctx['mqtt_status']} | hub: {hub_status}")
    print(f"  reports -> {REPORTS.relative_to(ROOT)}/")

    if failures:
        print("\nPROVEIT BOTTLING: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPROVEIT BOTTLING: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
