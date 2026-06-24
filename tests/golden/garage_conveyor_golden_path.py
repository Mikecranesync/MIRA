#!/usr/bin/env python3
"""Garage Conveyor Golden Path — the first real end-to-end customer workflow proof.

Proves, deterministically, that approved factory context is AUTHORITATIVE for MIRA:
a customer's conveyor evidence is seeded, the namespace/KG is approved, an unapproved
chunk is left unreviewed, and with the approval gate ON MIRA retrieves ONLY the approved
context. Approving the held-back chunk then makes it retrievable — proving the approval
action controls retrieval eligibility.

Reuses (does NOT duplicate): the real garage-conveyor component data (GS10 DURApulse,
Micro820 2080-LC20-20QBB, Banner photo eye), the kg_entities/namespace store, the
approval_state model, knowledge_entries.verified, and recall_knowledge's new gate.

Run (staging, self-cleaning):
  doppler run --project factorylm --config stg -- python tests/golden/garage_conveyor_golden_path.py
"""
from __future__ import annotations
import os, sys, json, uuid, pathlib

_REPO = pathlib.Path(__file__).resolve().parents[2]
os.chdir(_REPO)
sys.path.insert(0, str(_REPO / "mira-bots"))
import psycopg2

# A dedicated "Mike's garage" customer tenant — distinct from the SimLab/OEM tenants so the
# proof is about THIS customer's approved context only.
GARAGE_TENANT = "0000c0a6-0000-4000-8000-000000000001"
UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"
MARK = "golden://garage_conveyor"  # source_url marker → clean teardown

# Real conveyor evidence (grounded in plc/Micro820_v4.1.9_Program.st, demo-conveyor-001.sql,
# the GS10 manual excerpt, and the I/O wiring guide — NOT fabricated). Each chunk is a
# document a customer would upload. Three are APPROVED; one is held UNAPPROVED to prove the gate.
CHUNKS = [
    dict(approved=True, src=f"{MARK}/gs10_overcurrent.md", model="GS10",
         content="GS10 DURApulse VFD fault oC (over-current): output current exceeded rating during "
                 "accel/run. Causes: accel too fast, mechanical jam on the conveyor belt, shorted motor "
                 "lead. Check P01.12 accel time, inspect the belt for a jam, megger the motor leads U/V/W."),
    dict(approved=True, src=f"{MARK}/micro820_io.md", model="Micro820",
         content="Micro820 2080-LC20-20QBB I/O: I-02/I-03 = dual-channel E-stop (NC+NO, XOR-checked for "
                 "wiring fault), I-04 = run pushbutton, I-05 = entry photo eye PE-001, O-00 = green run lamp, "
                 "O-01 = red fault lamp, O-02 = safety contactor Q1."),
    dict(approved=True, src=f"{MARK}/gs10_modbus_params.md", model="GS10",
         content="GS10 RS-485 Modbus RTU: P09.00=1 slave address, P09.01=9600 baud, P09.04=RTU 8N1, "
                 "P09.09=10.0ms timeout. CRITICAL: P00.20=5 and P00.21=5 set the command source to RS-485; "
                 "with the default 0 the drive ignores Modbus run/freq commands."),
    # held back — a customer upload not yet reviewed by a human:
    dict(approved=False, src=f"{MARK}/UNREVIEWED_torque_note.md", model="GS10",
         content="DRAFT note (unreviewed): set GS10 P01.00 max frequency to 90 Hz to run the conveyor faster. "
                 "This is an unverified suggestion that has NOT been approved by maintenance."),
]

GATE = "MIRA_ENFORCE_APPROVED_RETRIEVAL"


def conn():
    return psycopg2.connect(os.environ["NEON_DATABASE_URL"])


def seed():
    """Step 0-2: provision the customer tenant; upload evidence; propose + approve structure."""
    c = conn(); cur = c.cursor()
    # Step 0 — customer/tenant setup (the FK to tenants makes this a real, required step)
    cur.execute("INSERT INTO tenants (id, name, contact_email, subscription_tier, subscription_status) "
                "VALUES (%s::uuid, 'Mike''s Garage (conveyor demo)', 'mike@home.garage', 'internal', 'active') "
                "ON CONFLICT (id) DO NOTHING", (GARAGE_TENANT,))
    cur.execute("DELETE FROM knowledge_entries WHERE source_url LIKE %s", (MARK + "%",))
    cur.execute("DELETE FROM kg_entities WHERE tenant_id=%s::uuid", (GARAGE_TENANT,))
    # knowledge_entries: 3 approved (verified=true) + 1 unapproved (verified=false)
    for ch in CHUNKS:
        cur.execute(
            "INSERT INTO knowledge_entries (tenant_id, content, source_url, source_type, "
            "model_number, manufacturer, equipment_type, verified, is_private) "
            "VALUES (%s::uuid, %s, %s, 'manual', %s, %s, 'conveyor', %s, true)",
            (GARAGE_TENANT, ch["content"], ch["src"], ch["model"],
             "AutomationDirect" if ch["model"] == "GS10" else "Allen-Bradley", ch["approved"]))
    # namespace/KG: site -> area -> asset -> 3 components, all approved (verified)
    nodes = [("site", "Home Garage", UNS.rsplit(".", 3)[0] if False else "enterprise.home_garage"),
             ("area", "Conveyor Lab", "enterprise.home_garage.conveyor_lab"),
             ("asset", "Conveyor 1", UNS),
             ("component", "GS10 VFD", f"{UNS}.gs10_vfd"),
             ("component", "Micro820 PLC", f"{UNS}.micro820_plc"),
             ("component", "Photo Eye PE-001", f"{UNS}.photoeye_1")]
    for etype, name, path in nodes:
        cur.execute(
            "INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, uns_path, approval_state) "
            "VALUES (%s::uuid, %s, %s, %s, %s::ltree, 'verified')",
            (GARAGE_TENANT, etype, str(uuid.uuid4()), name, path))
    c.commit(); c.close()


def recall(query, gate_on):
    os.environ[GATE] = "true" if gate_on else "false"
    os.environ["MIRA_TENANT_ID"] = GARAGE_TENANT
    os.environ["MIRA_SHARED_TENANT_ID"] = GARAGE_TENANT  # isolate to this customer for the proof
    import importlib
    from shared import neon_recall
    importlib.reload(neon_recall)  # re-read env for the gate
    hits = neon_recall.recall_knowledge(None, GARAGE_TENANT, limit=10, query_text=query)
    return [{"src": h.get("source_url"), "verified": h.get("verified")} for h in hits]


def approve(src):
    """The approval ACTION — what /api/proposals/[id]/decide does: flip to verified."""
    c = conn(); cur = c.cursor()
    cur.execute("UPDATE knowledge_entries SET verified=true WHERE source_url=%s", (src,))
    c.commit(); c.close()


def teardown():
    c = conn(); cur = c.cursor()
    cur.execute("DELETE FROM knowledge_entries WHERE source_url LIKE %s", (MARK + "%",))
    cur.execute("DELETE FROM kg_entities WHERE tenant_id=%s::uuid", (GARAGE_TENANT,))
    cur.execute("DELETE FROM tenants WHERE id=%s::uuid", (GARAGE_TENANT,))
    c.commit(); c.close()


def run() -> dict:
    seed()
    q = "GS10 conveyor over-current fault and Modbus command source"
    r = {"tenant": GARAGE_TENANT, "uns": UNS, "query": q, "steps": {}}

    # namespace/KG present + approved
    c = conn(); cur = c.cursor()
    cur.execute("SELECT entity_type, approval_state FROM kg_entities WHERE tenant_id=%s::uuid ORDER BY uns_path", (GARAGE_TENANT,))
    kg = cur.fetchall(); c.close()
    r["steps"]["1_evidence_seeded"] = len(CHUNKS)
    r["steps"]["2_namespace_kg_approved"] = {"nodes": len(kg), "all_verified": all(s == "verified" for _, s in kg)}

    off = recall(q, gate_on=False)
    on = recall(q, gate_on=True)
    unreviewed = f"{MARK}/UNREVIEWED_torque_note.md"
    r["steps"]["3_gate_off_sees_all"] = {"hits": len(off), "includes_unreviewed": any(h["src"] == unreviewed for h in off)}
    r["steps"]["4_gate_on_approved_only"] = {
        "hits": len(on), "all_verified": all(h["verified"] for h in on),
        "excludes_unreviewed": all(h["src"] != unreviewed for h in on)}

    # the approval action makes the held-back chunk retrievable
    approve(unreviewed)
    on2 = recall(q, gate_on=True)
    r["steps"]["5_approval_makes_retrievable"] = {
        "hits_after_approve": len(on2), "now_includes_unreviewed": any(h["src"] == unreviewed for h in on2)}

    # approved-source visibility (what an answer would report)
    r["steps"]["6_approved_source_count"] = sum(1 for h in on if h["verified"])

    # VERDICT: the gate is authoritative iff —
    #   off sees the unreviewed chunk, on excludes it (and returns only verified),
    #   and approving it makes it retrievable again.
    s = r["steps"]
    r["verdict"] = "PASS" if (
        s["3_gate_off_sees_all"]["includes_unreviewed"]
        and s["4_gate_on_approved_only"]["excludes_unreviewed"]
        and s["4_gate_on_approved_only"]["all_verified"]
        and s["5_approval_makes_retrievable"]["now_includes_unreviewed"]
    ) else "FAIL"
    teardown()
    return r


if __name__ == "__main__":
    keep = "--keep" in sys.argv  # leave the fixture seeded (for a live MIRA demo)
    out = run() if not keep else (seed() or {"seeded": True, "tenant": GARAGE_TENANT})
    print(json.dumps(out, indent=2))
    if not keep:
        sys.exit(0 if out.get("verdict") == "PASS" else 1)
