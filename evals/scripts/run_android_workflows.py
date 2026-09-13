"""Android product-parity workflow runner (Baseline Standard §4.1 / §10.3).

Layer 3 is a human/device evaluation: this tool does NOT pretend to fully
automate 15 UI journeys. It is the evidence recorder + device wrapper that
makes a device run reproducible and §12-valid:

  list                      show workflows + recorded verdicts for a results dir
  shot  WF_ID NAME          screenshot the connected device into the evidence dir
  record WF_ID VERDICT      record PASS|DEGRADED|FAIL|SKIP with evidence + notes
  finalize                  compute §5-section availability + write product.json

Device interaction (taps, typing, BACK) goes through tools/mobile-e2e/device.py
directly — same etiquette rules (focus check before taps, restore after).

Usage:
  python evals/scripts/run_android_workflows.py --out evals/results/<sha>/ list
  python evals/scripts/run_android_workflows.py --out evals/results/<sha>/ shot wf-01 newchat
  python evals/scripts/run_android_workflows.py --out evals/results/<sha>/ \
      record wf-01 PASS --evidence product-parity/wf01-newchat.png \
      --notes "blank greeting, 2 taps"
  python evals/scripts/run_android_workflows.py --out evals/results/<sha>/ finalize
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / "evals" / "product-parity" / "workflows.yaml"
DEVICE_PY = REPO / "tools" / "mobile-e2e" / "device.py"
VERDICTS = ("PASS", "DEGRADED", "FAIL", "SKIP")


def load_workflows() -> list[dict]:
    with open(WORKFLOWS, encoding="utf-8") as f:
        return yaml.safe_load(f)


def product_path(out: Path) -> Path:
    return out / "product.json"


def load_product(out: Path) -> dict:
    p = product_path(out)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"surface": "android", "workflows": [], "recorded": {}}


def save_product(out: Path, data: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    product_path(out).write_text(json.dumps(data, indent=2), encoding="utf-8")


def cmd_list(out: Path) -> int:
    data = load_product(out)
    recorded = data.get("recorded", {})
    for wf in load_workflows():
        mark = recorded.get(wf["id"], {}).get("verdict", "·")
        print(f"  {wf['id']}  [{mark:^8}]  {wf['name']}")
    done = len(recorded)
    print(f"{done}/{len(load_workflows())} recorded → {product_path(out)}")
    return 0


def cmd_shot(out: Path, wf_id: str, name: str) -> int:
    evidence_dir = out / "product-parity"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    # device.py writes to $EVIDENCE_DIR/NAME.png
    env = {"EVIDENCE_DIR": str(evidence_dir)}
    import os

    r = subprocess.run(
        [sys.executable, str(DEVICE_PY), "shot", f"{wf_id}-{name}"],
        env={**os.environ, **env},
        capture_output=True,
        text=True,
    )
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    return r.returncode


def cmd_record(out: Path, wf_id: str, verdict: str, evidence: str | None, notes: str | None) -> int:
    verdict = verdict.upper()
    if verdict not in VERDICTS:
        print(f"verdict must be one of {VERDICTS}", file=sys.stderr)
        return 2
    ids = {wf["id"]: wf for wf in load_workflows()}
    if wf_id not in ids:
        print(f"unknown workflow id {wf_id}", file=sys.stderr)
        return 2
    if verdict in ("PASS", "DEGRADED", "FAIL") and not evidence:
        print("PASS/DEGRADED/FAIL require --evidence (§12: no result without evidence)", file=sys.stderr)
        return 2
    if evidence and not (out / evidence).exists():
        print(f"evidence file not found under results dir: {evidence}", file=sys.stderr)
        return 2
    data = load_product(out)
    data.setdefault("recorded", {})[wf_id] = {
        "verdict": verdict,
        "evidence": evidence,
        "notes": notes or "",
        "at": datetime.now(timezone.utc).isoformat(),
    }
    save_product(out, data)
    print(f"{wf_id} = {verdict}")
    return 0


def cmd_finalize(out: Path) -> int:
    data = load_product(out)
    recorded = data.get("recorded", {})
    workflows = []
    fails = degraded = 0
    for wf in load_workflows():
        rec = recorded.get(wf["id"])
        if rec is None:
            print(f"NOT RECORDED: {wf['id']} {wf['name']} — refusing to finalize a partial run "
                  "(§10.1: no PASS from partial execution). Record it (SKIP needs --notes why).",
                  file=sys.stderr)
            return 1
        if rec["verdict"] == "SKIP" and not rec.get("notes"):
            print(f"{wf['id']} is SKIP without a reason note — §18 forbids silent waivers.", file=sys.stderr)
            return 1
        fails += rec["verdict"] == "FAIL"
        degraded += rec["verdict"] == "DEGRADED"
        workflows.append({"id": wf["id"], "name": wf["name"], "surface": "android", **rec})
    data["workflows"] = workflows
    data["summary"] = {
        "total": len(workflows),
        "pass": sum(w["verdict"] == "PASS" for w in workflows),
        "degraded": degraded,
        "fail": fails,
        "skip": sum(w["verdict"] == "SKIP" for w in workflows),
        "finalized": datetime.now(timezone.utc).isoformat(),
    }
    save_product(out, data)
    print(json.dumps(data["summary"], indent=2))
    return 0 if fails == 0 else 3


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="results dir for the tested SHA (evals/results/<sha>/)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p_shot = sub.add_parser("shot")
    p_shot.add_argument("wf_id")
    p_shot.add_argument("name")
    p_rec = sub.add_parser("record")
    p_rec.add_argument("wf_id")
    p_rec.add_argument("verdict")
    p_rec.add_argument("--evidence")
    p_rec.add_argument("--notes")
    sub.add_parser("finalize")
    a = ap.parse_args()
    out = Path(a.out)
    if a.cmd == "list":
        return cmd_list(out)
    if a.cmd == "shot":
        return cmd_shot(out, a.wf_id, a.name)
    if a.cmd == "record":
        return cmd_record(out, a.wf_id, a.verdict, a.evidence, a.notes)
    return cmd_finalize(out)


if __name__ == "__main__":
    sys.exit(main())
