#!/usr/bin/env python3
"""Push a flow JSON file into a running Node-RED via the Admin API.

Usage:
    python push_flow.py path/to/flow.json [http://localhost:1880]

Replaces ALL flows in the target NR with the contents of the file. Use
this only on the demo's dedicated mira-bridge container — never on a
shared NR with other tenants' flows.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def push(flow_path: str, base: str = "http://localhost:1880") -> None:
    with open(flow_path) as f:
        new_flows = json.load(f)

    # GET current flows, keep any tabs/nodes NOT prefixed fd- so we don't blow away
    # other tabs in this container (e.g. mira-dashboard-conveyor).
    try:
        req = urllib.request.Request(f"{base}/flows", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            existing = json.load(resp)
    except urllib.error.URLError as e:
        print(f"could not reach Node-RED at {base}: {e}", file=sys.stderr)
        sys.exit(1)

    existing_ids = {n["id"] for n in existing}
    new_ids = {n["id"] for n in new_flows}

    # Drop any nodes from existing that share ids with new (replacement) and any
    # nodes whose tab z is one of the new tabs.
    new_tab_ids = {n["id"] for n in new_flows if n.get("type") == "tab"}
    kept = [
        n for n in existing
        if n["id"] not in new_ids and n.get("z") not in new_tab_ids
    ]
    merged = kept + new_flows
    print(f"existing nodes: {len(existing)}  kept: {len(kept)}  new: {len(new_flows)}  total: {len(merged)}")

    body = json.dumps(merged).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/flows",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Node-RED-Deployment-Type": "full",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print("response:", resp.status, resp.read().decode("utf-8")[:200])
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8')[:500]}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    push(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "http://localhost:1880")
