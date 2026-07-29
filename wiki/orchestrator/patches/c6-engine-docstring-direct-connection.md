# C6 patch — fix stale direct-connection docstring in engine.py

**Lens:** C (Engine integrity), round 6 (2026-06-13)
**Severity:** doc/code drift — NOT a beta blocker. Surgical, doc-only.
**Target:** `origin/main` @ `b2d74f7c` (deploy truth). The working tree
(`feat/realtime-datapoint-clock`, 98 behind, engine.py locally modified) is NOT
the apply target — branch off `origin/main`.

## What it fixes

`mira-bots/shared/engine.py` `process_full()` docstring (origin/main L1164-1165)
says the `direct_connection` marker *"does NOT by itself alter gate firing (the
full gate bypass is master-plan Phase 6)."*

That is **stale**. `_should_fire_uns_gate` (engine.py:5469) DOES return `False`
(skips the chat confirmation gate) when `uns_context["source"] == "direct_connection"`.
The behavior shipped; only the docstring lagged. A future editor reading the
docstring could wrongly assume direct-connection turns are still gated and
"fix" the carve-out — re-introducing the exact anti-pattern
`.claude/rules/direct-connection-uns-certified.md` forbids.

The patch rewrites the docstring to state the true behavior (marker skips the
chat-gate) and names what is actually still incomplete: RESOLUTION-based
certification (the `asset_context→(uns_path|equipment_id)` resolver +
`ENFORCE_ASSET_AGENT_GATE`, both pending in ignition_chat.py:254-259).

## Apply

```bash
cd ~/MIRA
git fetch origin main
git switch -c fix/c6-engine-docstring-direct-connection origin/main
git apply --check wiki/orchestrator/patches/c6-engine-docstring-direct-connection.patch
git apply wiki/orchestrator/patches/c6-engine-docstring-direct-connection.patch
```

## Verify

```bash
# 1. Docstring no longer contradicts the gate helper:
sed -n '1160,1176p' mira-bots/shared/engine.py        # should describe the skip + the resolution gap
# 2. The behavior it documents is real:
grep -n "source.*==.*direct_connection" mira-bots/shared/engine.py   # -> L~5469 returns False
# 3. No code path changed (doc-only):
git diff --stat origin/main   # 1 file, only the docstring hunk
ruff check mira-bots/shared/engine.py
```

## Not included (deliberately — separate, larger work)

The real hardening — converting presence-based certification to resolution-based
(land the `asset_context→(uns_path|equipment_id)` resolver, then flip
`ENFORCE_ASSET_AGENT_GATE` on) — is master-plan Phase 6 and out of scope for a
doc patch. Tracked as the Lens C YELLOW sub-item in BETA_READINESS.md.
