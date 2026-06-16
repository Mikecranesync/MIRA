# Offline Test Harness — v3.4.0 Plan

**Status:** In progress — implementation in `local_66f993fa` session  
**Tracking:** Issues #287–#291 on [Mikecranesync project board](https://github.com/users/Mikecranesync/projects/4)  
**References:** ADR-0010 (Karpathy alignment), [Karpathy eval pattern](https://karpathy.github.io/2022/03/14/lecun1989/)

---

## Why

The VPS outage in April 2026 exposed a fundamental gap: **every test required the deployed
system**. Iterating on a diagnostic scenario meant:

1. Edit code on Charlie
2. Push to VPS (manual docker cp or SSH)
3. Open phone → Telegram → send message
4. Read response
5. Repeat

A single iteration took 2–5 minutes and depended on VPS health, SSH, and a physical phone.
This is incompatible with rapid experimentation and makes automated CI meaningless (CI can't
reach the VPS, so it never actually tests the thing).

**Target state:** Mike must be able to test a new fault scenario, including photo input, in
under 30 seconds without touching the deployed system or his phone.

---

## Component Overview

| # | Issue | Priority | Description | Ships together? |
|---|-------|----------|-------------|-----------------|
| 1 | #287 | P0 | Local in-process pipeline runner | Yes — P0 core |
| 2 | #288 | P0 | Photo fixture support + synthesized nameplate images | Yes — P0 core |
| 3 | #289 | P1 | Synthetic user agent (Karpathy LLM persona) | No — P1 improvement |
| 4 | #290 | P0 | One-command CLI (`offline_run.py`) | Yes — P0 core |
| 5 | #291 | P1 | `replay.py` — production chat_id offline replay | No — P1 improvement |

**v3.4.0 ships when components 1 + 2 + 4 are done.** Components 3 and 5 ship incrementally
as P1 improvements.

---

## Component 1 — Local In-Process Pipeline Runner (#287, P0)

**File:** `tests/eval/local_pipeline.py`

### The problem

The existing `run_eval.py` sends HTTP requests to `mira-pipeline` on the VPS (`:9099`). If
the VPS is down, the eval runner returns nothing. There's no way to run even a single
scenario offline.

### The solution

Instantiate `GSDEngine` / `Supervisor` + `RAGWorker` + `InferenceRouter` directly in the
test process:

```python
from mira_bots.shared.engine import Supervisor

supervisor = Supervisor(
    db_path=":memory:",          # SQLite in-memory — no file persistence needed
    openwebui_url="",            # Not used in cloud inference mode
    api_key="",
    collection_id=os.environ["KNOWLEDGE_COLLECTION_ID"],
    tenant_id=os.environ.get("MIRA_TENANT_ID"),
)

result = await supervisor.process_full(chat_id="eval_local", message="GS20 showing F-08")
```

NeonDB connects directly via `NEON_DATABASE_URL` (same env var, already in Doppler). LLM
calls go to real Anthropic/Groq via the cascade router. No Docker, no SSH, no VPS.

**Fallback:** if `NEON_DATABASE_URL` is unset or unreachable, substitute an in-memory stub
that returns empty chunks (honesty signal fires, which is testable).

---

## Component 2 — Photo Fixture Support + Synthesized Nameplates (#288, P0)

**Directory:** `tests/eval/fixtures/photos/`

### The problem

The vision pipeline is completely untested in the offline harness. Photo tests require either
a phone camera or manually prepared base64 images. There's no deterministic photo fixture set.

### The solution

**Synthesize nameplates with Pillow** — generate minimal but realistic nameplate images at
eval-time (not committed as binary blobs):

```python
from PIL import Image, ImageDraw, ImageFont

def make_nameplate(vendor, model, voltage, hz) -> str:
    """Return base64 PNG of a synthetic nameplate."""
```

**Fixture format extension** — eval YAML gets an optional `photo:` field:

```yaml
id: pilz_pnoz_x3_photo_01
photo:
  synthesize:
    vendor: Pilz
    model: PNOZ X3
    voltage: 24VDC
    hz: ~
expected_keywords: [Pilz, PNOZ, X3]
turns:
  - role: user
    content: "What's on this nameplate?"
```

**Initial fixture set:**

| File | Vendor | Model | Voltage | Challenge |
|------|--------|-------|---------|-----------|
| `pilz_pnoz_x3.yaml` | Pilz | PNOZ X3 | 24VDC | Known vendor, clear model |
| `automation_direct_gs20.yaml` | AutomationDirect | GS20 | 480VAC | Text-heavy nameplate |
| `yaskawa_ga500.yaml` | Yaskawa | GA500 | 480V/3ph | Multi-line format |
| `distribution_block.yaml` | — | — | — | Vague photo — no vendor → honesty signal |

Pass criterion: vision pipeline correctly extracts vendor + model for ≥3 of 4 fixtures.

---

## Component 3 — Synthetic User Agent (#289, P1)

**File:** `tests/eval/synthetic_user.py`

### The problem

Scripted fixtures cover known failure modes. They miss the long tail: situations that only
emerge from natural back-and-forth, where the technician changes their mind, asks an
unexpected question, or provides incomplete information.

### The solution

An LLM plays "industrial maintenance technician on the shop floor." The persona has
deliberate constraints to maximise realism:

- **Sometimes doesn't know the answer** — says so honestly ("not sure, let me check")
- **Sometimes gives incomplete info** — forces MIRA to ask follow-up questions
- **Sometimes changes topic mid-conversation** — tests FSM state transitions
- **Sometimes asks for a manual mid-diagnosis** — tests the MANUAL_LOOKUP_GATHERING subroutine
- **Sometimes uses escape hatches** — "skip", "back to troubleshooting" — tests the escape logic
- **Shop-floor vocabulary** — "the thing trips out", not "the drive faults"

This is the Karpathy synthetic-user pattern from ADR-0010, extended to the full diagnostic
conversation loop. The existing `tests/synthetic_eval.py` is a starting point.

**Success criterion:** drives ≥5 multi-turn diagnostic conversations end-to-end, and surfaces
≥1 failure mode that scripted fixtures didn't catch (commit the failure as a new fixture).

---

## Component 4 — One-Command CLI `offline_run.py` (#290, P0)

**File:** `tests/eval/offline_run.py`

### The problem

Running even a single scenario offline requires understanding `run_eval.py`, setting up
environment variables, knowing the fixture format, and decoding the scorecard Markdown.
The barrier to "just test this" is too high.

### The solution

```bash
# Quick one-off photo test
python tests/eval/offline_run.py --photo path/to/nameplate.jpg

# Fresh diagnostic conversation with synthetic user
python tests/eval/offline_run.py --scenario "GS20 showing F-08 overcurrent" --synthetic-user

# Full fixture suite
python tests/eval/offline_run.py --suite full --judge

# Branch comparison
python tests/eval/offline_run.py --suite text --diff vs main
```

**Output format** — rich terminal display:
- Color-coded per-scenario pass/fail
- FSM state trajectory (IDLE → Q1 → Q2 → DIAGNOSIS → RESOLVED)
- Judge scores (if `--judge`)
- Runtime per scenario
- Summary: X/Y pass, N failures

**Performance targets:**
- `--photo` mode: under 10 seconds end-to-end
- `--suite full --judge`: under 2 minutes

`offline_run.py` replaces `python tests/eval/run_eval.py` as the primary inner-loop tool
and is documented in CLAUDE.md accordingly.

---

## Component 5 — `replay.py` Production Failure Debugger (#291, P1)

**File:** `tests/eval/replay.py`

### The problem

When a production failure is reported (e.g. Mike's 2026-04-14 Pilz distribution-block
incident), diagnosing it requires:
1. SSH to VPS to pull the interaction from the database
2. Manually reconstructing the conversation turns
3. Guessing what the system state was at each turn

There's no way to reproduce a production failure locally.

### The solution

```bash
python tests/eval/replay.py --chat-id abc123def456
# or, without VPS:
python tests/eval/replay.py --file tests/eval/fixtures/replay/pilz_forensic_2026-04-14.json
```

Given a `chat_id` from the `interactions` table **or** a committed JSON dump, the replayer:
1. Extracts the exact user turns in order
2. Runs each turn through the local pipeline
3. Diffs current code's responses against the original responses
4. Highlights where the current version would behave differently

**Initial replay corpus** (committed to `tests/eval/fixtures/replay/`):

| File | Incident | Key failure |
|------|----------|-------------|
| `pilz_forensic_2026-04-13.json` | Pilz safety relay session | Unknown |
| `distribution_block_forensic_2026-04-14.json` | Mike's live distribution block | Turn 4: manual request routed to diagnostic FSM (fixed in v2.4.1); Turn 2: false attribution "main power cable" (fixed in v2.4.1) |

**Success criterion:** replaying `distribution_block_forensic_2026-04-14.json` on pre-v2.4.1
code produces the known failure; replaying on current main shows both fixes.

---

## Implementation Order

```
Week 1 (v3.4.0 P0):
  Component 1 → Component 4 → Component 2
  (pipeline first, then CLI wrapper, then photo support)

Week 2 (P1 improvements):
  Component 5 (replay corpus + script)
  Component 3 (synthetic user agent)
```

Components 1 + 4 are the load-bearing pair: the pipeline runner without the CLI is
harder to use; the CLI without the pipeline runner has nothing to call. Build them
together before adding photo support.

---

## Definition of Done for v3.4.0

```bash
# This command must work, produce output, and finish in under 30 seconds:
cd /Users/charlienode/MIRA && \
  doppler run --project factorylm --config prd -- \
  python tests/eval/offline_run.py --suite text
```

Plus:
- `--photo` mode works with a local JPEG (any nameplate)
- All P0 items on the kanban board moved to Done
- CLAUDE.md updated: `offline_run.py` listed as primary inner-loop eval tool
- No regression on existing 33+ eval fixtures
