# Discovery — Live Machine Evidence assessment on the Ignition HMI surface

**Date:** 2026-07-05
**Goal:** Give the Ignition direct-connection "Ask MIRA" (`mira-pipeline/ignition_chat.py`) the
deterministic **assessment** that #2478 added to the engine's `_maybe_attach_live_snapshot` path.
Follow-up to #2476 (Hub) and #2478 (engine).

## Why the engine's `assess_snapshots` can't be reused as-is

`ignition_chat.py` does NOT go through `_maybe_attach_live_snapshot`; it pre-bakes its own
preamble (`_format_tag_preamble`) and calls `engine.process(...)` without `live_tags=`. And its
snapshot has a fundamentally different shape than `live_snapshot.normalize` expects.

**The wire format (definitive — `ignition/webdev/FactoryLM/api/chat/doPost.py:96-103`):**
```python
tag_values = system.tag.readBlocking(tag_paths)
snapshot[path] = {"value": str(qv.value), "quality": str(qv.quality), "timestamp": ...}
```
So the snapshot MIRA receives is `{ "[default]Mira_Monitored/<asset>/<leaf>": {"value": "<str>", …} }`:
- **Keys are full Ignition browse paths**, not the short canonical datapoints
  (`vfd_fault_code`) that `live_snapshot._decode_one` matches.
- **Values are strings** (`str(qv.value)`) — `_decode_one`'s `_num()` returns `None` for strings,
  so nothing decodes.
- **Analog scaling is ambiguous.** `Mira_Monitored/*` can hold raw registers (`3000` = 30 Hz ÷100)
  OR engineering values (`30.0`). `live_snapshot` assumes raw and divides; feeding an already-scaled
  value would report `0.3 Hz` / `32 V`. **A 10×/100× wrong number is worse than no number.**

## The safe slice — assess from the ENUM/BOOL facts only

The "VFD-healthy-but-stopped / active-fault / comms-down / running" conclusion depends on
**scaling-immune** signals: `vfd_fault_code` (0 = no fault), `vfd_comm_ok`, `vfd_cmd_word`
(STOP/RUN), `vfd_status_word` (STOPPED/RUNNING), and the safety bools. It does NOT need the analog
values. So:

1. **New pure helper `assess_from_paths(path_values)` in `live_snapshot.py`** — maps full paths →
   leaf, keeps ONLY the enum/bool canonical leaves (`_ASSESSABLE_LEAVES`), coerces the string wire
   value per-leaf-type (int for `vfd_fault_code`/`cmd`/`status`; bool for `vfd_comm_ok`/safety —
   parsing `"true"/"false"/"1"/"0"` correctly so `"False"` isn't truthy), then `normalize()` +
   `assess_snapshots()`. **Analog leaves are deliberately excluded** — never re-scaled/re-interpreted.
   Returns `None` when no assessable tag is present (honest silence, never a fabricated assessment).
2. **`ignition_chat.py`** — append the assessment (+ the same live/context/inference/next-checks
   separation instruction as #2478) to the existing `_format_tag_preamble` output. The `[LIVE TAGS
   …]` block (with the analog values shown verbatim, as the client sent them) is preserved.

The healthy-but-stopped message still reads well from enum facts alone:
*"VFD looks healthy (comms OK, no fault) but the machine is stopped — most likely a
command/permissive/interlock, not the drive."* (facts = comms OK + no fault; no analog numbers
claimed.)

## Scope / non-goals
- Text-preamble only; the direct-connection UNS certification, the reject-on-missing-identifier
  contract, and the trace-only `tag_evidence` are all untouched.
- No analog value is re-scaled or re-interpreted (the core safety property).
- No engine evidence/citation-contract change; no write path.

## Deferred (documented)
- An **analog** assessment on the Ignition path needs a trustworthy value contract — either
  `tag_entities.expected_envelope` (assess against per-tag min/max/normal/fault_states) or a
  confirmed raw-vs-engineering flag on the wire. Until then, analog values are shown but not
  assessed.
- Unifying the two preamble builders / a structured citable live-evidence type in the Supervisor
  (from #2478's deferred list).
