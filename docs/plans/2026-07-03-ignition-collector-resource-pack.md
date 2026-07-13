# Ignition Collector Resource Pack — Plan

**Date:** 2026-07-03 · **Status:** BLOCKED on one bench step (timer format capture) · **Owner:** Mike + Claude
**Goal:** the FactoryLM tag collector installs through **official Ignition mechanisms** — no file copying into `data/projects/`, no Designer hand-pasting.

---

## Why this exists

The June 2026 "config-as-files" install wrote the `MiraTagStream` timer as a hand-crafted folder under
`data/projects/FactoryLMCollector/ignition/event-scripts/…`. Ignition 8.3 **never loaded it** — the timer
never fired once (zero log lines, June→July), and the CV-101 bench proof stalled on it. The script *content*
was right; the *registration format* was guessed. This plan replaces guessing with Ignition's own formats.

## The three official distribution formats

| # | Format | Install path | Effort | Verdict |
|---|--------|-------------|--------|---------|
| 1 | **Project export `.zip`** | Gateway web UI → Config → Projects → **Import**, or Designer File→Import | Low | **BUILD NOW** — the immediate deliverable |
| 2 | **Ignition Exchange package** | exchange.inductiveautomation.com → download → gateway import | Low-medium | **BUILD NOW** — wraps #1 with the Exchange manifest; extends the existing `mira-ignition-exchange/` listing (ChatDock + ScanWidget) |
| 3 | **Signed `.modl` module** (Ignition Module SDK, Java) | Gateway → Config → Modules → Install | High (Java build + signing certs) | **ROADMAP** — this is the Maintenance Intelligence Module productization (`docs/RESUME_2026-06-14_maintenance-intelligence-module.md`); not this ticket |

## What the pack contains

```
FactoryLMCollector-<version>.zip           ← Ignition project export
├── project.json                           (title, enabled, not inheritable)
├── ignition/script-python/collector/      (pure module — already correct 8.x format)
├── ignition/script-python/signing/        (HMAC signer — already correct)
├── ignition/script-python/allowlist/      (gateway-side allowlist loader — already correct)
└── ignition/event-scripts/…               ← THE PART THAT MUST MATCH GROUND TRUTH (see below)
```

Plus, alongside (not inside) the zip:
- `factorylm.properties.template` (INGEST_URL / TENANT_ID / MIRA_HMAC_KEY / STREAM_TAG_FOLDER / STREAM_SOURCE_CONNECTION_ID placeholders)
- `approved_tags.json` sample (or pointer to the tenant's seeded allowlist)
- `INSTALL.md`: import zip → drop properties file at `data/factorylm/` → verify logger `FactoryLM.Mira.TagStream` shows `Streamed N/M allowlisted tags`

## The one dependency: ground-truth timer format

**Do not build the event-scripts resource from documentation or memory — capture it.**

1. Mike creates the timer ONCE in Designer on the bench gateway (exact steps below).
   *(This same save is what lights up the CV-101 live proof — two birds.)*
2. Claude reads the project directory remotely afterwards and captures **exactly** what Ignition 8.3
   wrote to disk for the registered timer (file names, resource.json shape, any data.bin / signature files).
3. That captured structure becomes the template in the repo. The pack is then guaranteed-loadable,
   because it *is* what Ignition itself writes.

---

## ✅ YOUR STEPS (Mike) — do these at the bench laptop, ~3 minutes

### Step 1 — Copy the timer script
1. Open **Notepad** (or any editor) on this file:
   ```
   C:\Program Files\Inductive Automation\Ignition\data\projects\FactoryLMCollector\ignition\event-scripts\timer\MiraTagStream\code.py
   ```
2. **Select all (Ctrl+A) → Copy (Ctrl+C).** This is the timer script — it's been staged there since June; it just was never registered.

### Step 2 — Register the timer in Designer
1. Open **Ignition Designer** on the laptop (Designer Launcher → the local gateway).
2. Open project **FactoryLMCollector**.
3. Menu bar: **Project → Gateway Events**.
4. Click the **Timer** tab → click **➕** (add new timer script).
5. Configure it exactly:
   | Setting | Value |
   |---|---|
   | Name | `MiraTagStream` |
   | Delay | `2000` (milliseconds) |
   | Delay type | **Fixed Rate** |
   | Threading | **Dedicated** |
   | Enabled | ✔ checked |
6. **Paste the script** (Ctrl+V) into the code editor pane.
7. Click **OK**, then **Save the project** (Ctrl+S; choose *Save and Publish* if prompted).

### Step 3 — Tell Claude "timer saved"
Everything after that is automated:
- Claude watches the gateway log for `Streamed N/M allowlisted tags (attempts=1)` (logger
  `FactoryLM.Mira.TagStream`) — should appear within ~10 seconds of the save.
- Verifies the first gateway-born rows in prod `tag_events` (count rising past 29, `simulated=false`,
  `source_connection_id=cv101-bench-gw`).
- Captures the timer's on-disk resource format for this pack.
- Flips `MIRA_RUN_DIFF_ENABLED=1` + redeploys the historian → state windows + anomalies persist.
- Screenshots the populated machine-memory card on app.factorylm.com.

### If something looks wrong
- **No log line after ~30 s:** in Designer check Project → Gateway Events → Timer shows the script
  Enabled; re-save. Check the gateway log for red errors mentioning `MiraTagStream` or `collector`.
- **Log shows `401`/`signature_mismatch`:** tell Claude — key mismatch (unexpected; keys were
  SHA-256-verified matching today).
- **Log shows `No allowlisted tags`:** the tag folder didn't match — tell Claude; the fallback is
  changing `STREAM_TAG_FOLDER` in `C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties`
  from `[default]MIRA_IOCheck` to `[default]Conveyor` (any editor works IF run as administrator; or ask
  Claude to re-stage + UAC it).
- **Undo everything:** restore `factorylm.properties.bak-20260703` over `factorylm.properties`
  (elevated) and delete the timer in Designer → Save.

### Optional while you're there (recommended)
- **Stop the laptop napping** (it kills the live demo): elevated PowerShell →
  `powercfg /change standby-timeout-ac 0`
- **The demo money shot** (after Claude confirms rows flowing): pull the **e-stop** (→ A3 anomaly)
  or unplug the **RS-485 cable at the GS10** (→ A1 comm-stale, critical) — then watch the machine-memory
  card light up with the fault, its evidence, and the live "Create work order" button. Re-plug/reset after.

---

## Build + guard (the PR that follows capture)

- `tools/build_ignition_collector_pack.py` — assembles the zip deterministically from the repo's
  `ignition/` sources (`gateway-scripts/tag-stream.py` → timer body; `webdev/FactoryLM/api/tags/collector.py`,
  `api/chat/signing.py`, `api/tags/allowlist.py` → script-python modules) + the captured event-scripts template.
- CI test (`tests/ignition/test_collector_pack.py`): zip structure matches the captured template; packaged
  script bodies are **byte-identical** to the repo sources (same parity discipline as the vendored anomaly
  rules); version stamp matches `/VERSION`.
- Exchange manifest under `mira-ignition-exchange/collector/` reusing the existing listing conventions.
- Output artifact committed to releases (or built on tag), never hand-edited.

## Install flow after this ships (customer-grade)

1. Download `FactoryLMCollector-x.y.z.zip` (Exchange or release link).
2. Gateway web UI → Config → Projects → Import.
3. Copy `factorylm.properties.template` → `data/factorylm/factorylm.properties`, fill 3 values
   (INGEST_URL, TENANT_ID, MIRA_HMAC_KEY).
4. Watch the gateway log for `Streamed N/M allowlisted tags`. Done — no Designer required.

## Bench state at time of writing (context)

- Cloud pipe **proven end-to-end** 2026-07-03: signed smoke row → relay (tailnet 100.68.120.99:8765) →
  HMAC ✓ → allowlist ✓ → `tag_events` row written (garage tenant `e88bd0e8-…`).
- `factorylm.properties` on the bench laptop already points at the tailnet relay + garage tenant (applied
  via UAC-elevated script, backup at `factorylm.properties.bak-20260703`).
- The ONLY missing link is the timer registration (step 1 above).

## Roadmap note (format #3)

When the collector graduates to a signed `.modl`, the timer moves from a project resource into the module
itself (gateway-scoped managed executor), the properties file becomes gateway settings UI, and Exchange
distribution is replaced by module hosting. That is the Maintenance Intelligence Module track — separate
plan, do not block this pack on it.
