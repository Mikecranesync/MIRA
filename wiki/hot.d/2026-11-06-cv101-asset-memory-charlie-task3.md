# CV-101 real-equipment acceptance — CHARLIE task3

Mike selected his real home conveyor to replace incomplete PUMP-01 field
acceptance in draft #5241. Audited candidate300685118582f14e5bef3c049939e5baf8fc3780;
main/staging090c8e15; production version endpoint489088d4. No deployment.

[Evidence pack](../../docs/proofs/cv101-asset-memory-acceptance/README.md)
contains the inventory/topology/tag map, physical-source conflicts, current
read-only production receipt, actual endpoint timings/login screenshot and
progressive operator procedure. The cloud garage CMMS UUID/KG bridge exists;
cross-tenant notebook query omits identifiers and cannot prove garage binding.
Production source group plc_bridge/cv101-bench-modbus contains721 distinct
observations, newest2026-11-05 22:25:02.165Z, over12h old at inspection. Ignition
has historical observations/later receipts, newest receiptNov5 22:58:57.993116Z;
grouped clocks alone cannot diagnose replay versus report-by-exception.

db-inspect42202828348 timed out after5minutes, preserving completed identity
and telemetryA/B results. Dedicated live gate disabled/dispatch422; left disabled.
Bench historian GET refused, current laptop-reference health GET timed out.
Normal browser requires owner sign-in. Anonymous CV-101 context/documents/
machine-memory all401. No QA tenant credential substitution or access bypass.

Two read-only auditors reviewed physical/manual provenance and integration
history. Independent blocked-assessment review caught and resolved notebook
identity scope and Ignition clock-contract overstatements. The physical chain
is incomplete and has no field acceptance. Focused existing software tests:
148passed/2Docker-render checks skipped. No software defect was established
requiring a speculative implementation or architecture change.

Status BLOCKED / NOT MERGE READY. Need existing garage-owner session plus a
fresh accessible existing reader. Leave equipment stopped now; later normal
transition requires Mike's explicit confirmation and existing operator procedure.
Existing PLC-laptop restoration ownership preserved. No new poller, second
serial master, bus command, graph promotion, source write, production config,
migration, purchase, merge or deploy. Review/CI for the new evidence commit
must be read from the PR's current checks/comments, not inherited from300685.
