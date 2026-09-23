# eval-fixer run — 2026-09-23 (charlienodes-mac-mini)

- Scorecard: 53/65 passing (82%) — `tests/eval/runs/2026-09-23T0132-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876)
- No patch. Watchdog reported 3 file_clusters (Step-2 hard stop), but the substantive
  reason is that the engine.py failures pull in opposite directions: `02`/`03` stall at Q2
  and need FEWER questions, while `34` is a stale fixture whose expected Q1 predates the UNS
  confirmation gate (engine is correct there), and `60` bails to IDLE and needs better
  context-switch handling. No single patch satisfies all three.
- Added over the single-run view: failure frequency across the last 8 runs. Five fixtures
  fail 8/8 with an identical checkpoint signature (`pf525_f004_02`, `gs20_cross_vendor_03`,
  `gs3_ground_fault_14`, `self_critique_low_groundedness_34`, `topic_switch_gs10_to_pf525_22`);
  everything under 5/8 is live-inference flap (pass rate swings 46–54 on unchanged behaviour).
- Flagged for human ruling: MIRA answering with a Modbus control write ("write value 2 to
  register 0x2002"), recurring in runs on 09-07/10/13/15/23 — a read-only-in-beta product
  question, not an eval bug. Plus a safety STOP false positive on a heatsink-temp question.
- Correction (self-caught before close): I first reported `gs3_ground_fault_14` as a one-line
  UNS alias gap and "the cheapest real win". Wrong — `"gs3": "AutomationDirect"` is already in
  `VENDOR_ALIASES` (uns_resolver.py:55); only `FAMILY_FROM_ALIAS` omits it, and line 52
  documents that as deliberate so confidence stays 0.5 and the UNS gate fires. So GS3 is a
  SECOND fixture-vs-gate case alongside `34`, not a resolver bug. Posted comment was patched.
- Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5789374836
