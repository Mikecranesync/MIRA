"""One-command ProveIt Conv_Simple demo gate.

    python demo/run_demo.py        # from the worktree root

Proves the full demo spine, in order: evidence folder -> asset/UNS model -> deterministic fault
scenario -> Ask-MIRA answer card with receipts -> narrow MQTT/UNS event that reproduces the SAME card.

Exits NONZERO on: missing evidence, an answer card without real receipts, or an MQTT card that does not
match the offline card. NO Ignition/OPC-UA/OpenPLC/Modbus — one clean path.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _p in (str(HERE), str(HERE.parent / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import conv_simple_demo as demo  # noqa: E402
import mqtt_demo  # noqa: E402

REQUIRED_ASSET_FOLDERS = ("vfd", "plc", "photoeye", "motor", "conveyor", "wiring-io")


def _utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def main() -> int:
    _utf8_stdout()
    failures: list = []
    ev_dir = HERE / "evidence"

    # 1. evidence folder
    print("== ProveIt Conv_Simple demo ==\n[1/5] evidence folder ...")
    if not (ev_dir / "README.md").exists():
        failures.append("demo/evidence/README.md missing")
    for f in REQUIRED_ASSET_FOLDERS:
        if not (ev_dir / f / "notes.md").exists():
            failures.append(f"demo/evidence/{f}/notes.md missing")
    if not (ev_dir / "evidence_manifest.json").exists():
        failures.append("evidence_manifest.json missing")

    # 2. model + manifest
    print("[2/5] asset/UNS model + evidence manifest ...")
    manifest = demo.load_manifest()
    asset_keys = {a["key"] for a in manifest["assets"]}

    # 3. scenario + answer card
    print("[3/5] flagship scenario -> answer card ...")
    card = demo.build_answer_card(demo.FLAGSHIP, manifest)
    md = demo.render_card(card)
    reports = HERE / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "answer_card.md").write_text(md + "\n", encoding="utf-8")
    (reports / "answer_card.json").write_text(json.dumps(card.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n" + md + "\n")

    # receipts must be real manifest entries (no invention)
    manifest_ids = {e["id"] for e in manifest["evidence"]}
    if not card.manuals_used:
        failures.append("answer card has no manuals/receipts")
    for m in card.manuals_used:
        if m["id"] not in manifest_ids:
            failures.append(f"answer card cites a non-manifest receipt: {m['id']}")
    if "photoeye" not in card.most_likely_cause.lower():
        failures.append("flagship most_likely_cause is not the photoeye")

    # 4. MQTT/UNS round trip
    print("[4/5] MQTT/UNS round trip ...")
    rt = mqtt_demo.run_round_trip(demo.FLAGSHIP, manifest)
    (reports / "mqtt_report.md").write_text(
        f"# MQTT/UNS round trip\n\n- topic: `{rt['topic']}`\n- delivered: {rt['delivered']}\n"
        f"- MQTT card == offline card: **{rt['match']}**\n\n```json\n{rt['payload']}\n```\n",
        encoding="utf-8",
    )
    print(f"  topic: {rt['topic']} | delivered: {rt['delivered']} | card preserved: {rt['match']}")
    if rt["delivered"] != 1:
        failures.append("MQTT event was not delivered exactly once")
    if not rt["match"]:
        failures.append("MQTT answer card != offline answer card")

    # 5. tests
    print("\n[5/5] pytest ...")
    rc = subprocess.call([sys.executable, "-m", "pytest", str(HERE / "tests"), "-q"])
    if rc != 0:
        failures.append(f"pytest exit {rc}")

    if failures:
        print("\nDEMO: FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nDEMO: OK ({len(asset_keys)} real assets, answer card with {len(card.manuals_used)} "
          f"receipts, MQTT card preserved, tests green)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
