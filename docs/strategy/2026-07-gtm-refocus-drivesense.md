# GTM Refocus — Drive Commander (DriveSense) as the First Sellable Wedge

**Date:** 2026-07-06 · **Repo state at drafting:** `origin/main` @ VERSION 3.75.0 (pre-#2501) · **Method:** read-only audit (3 sub-agents) + synthesis + brutal-honesty review. No code changed to produce this report.

> **Status update since drafting (2026-07-06, same day):** the pack-v2 flip (**PR #2501**) has since **merged and deployed** — VERSION is now 3.76.0 and **CE10→P09.03 is live in prod** (§3's "inert/gated" parameter/keypad row is now LIVE for GS10). The PowerFlex 525 generalization work has begun: the manual→pack extractor is open as **PR-A #2503**. The analysis, wedge, 30-day plan, and recommendation below all still hold; treat the "inert" framing of the GS10 parameter/keypad card as superseded by #2501.

> **Decision filter used throughout:** *Does this make the loop "contextualize one drive we did NOT seed → produce a cited, read-only diagnosis a technician would trust" work better?* Keep if yes, pause if no.

---

## 1. Executive summary

**Plain-English conclusion.** The narrowest real wedge in the repo is **Drive Commander**: a read-only VFD troubleshooting tool that turns a drive's fault + the OEM manual into cited, technician-ready next steps on a phone. It is the right wedge — narrow, visual, technician-relevant, and it's where the last ~9 PRs went.

**Recommended wedge.** Sell **Drive Commander** (working name; branding is an open decision — see §8), first family **DURApulse GS10**, positioned context-led ("you're buying the drive intelligence"), with "ask your machine" as the *demo*, never the headline. Canonical doc: `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`.

**What to stop.** The whole-plant "signal difference engine" framing (`docs/product/what-is-mira.md`, `mira_difference_engine_offering.md`), any copilot framing (`README.md`, `mira_prd_v2.md`, ADR-0014), new chat adapters, dashboard polish, the historian/trending epic, and — non-negotiable — anything that writes to a PLC or drive.

**What to do next (one move — DONE as of #2501).** Upgrade the shipped `durapulse_gs10` pack to v2 — this flipped the CE10→P09.03 parameter+keypad card from inert to live. It was the single highest-leverage move and is the precondition for every demo video. **Now done.** The next generalization move is the PowerFlex 525 pack via a reusable manual→pack extractor (PR-A #2503).

---

## 2. Repo evidence

**Supports Drive Commander as the wedge:**
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` § Decision — *the* canonical statement: "The single sellable product is a read-only VFD diagnostic tool, 'Drive Commander,' whose sellable atom is a per-model 'drive pack'… context-led; 'Ask your machine' is the proof-demo, never the headline." (Accepted 2026-07-05.)
- `docs/discovery/mira_single_product_research.md` — the grilling memo behind ADR-0025; sharpest one-line pitch + honest maturity verdict ("closer to private beta than sellable-beta").
- `CONTEXT.md` § "Drive Commander product (ADR-0025)" — the most precise current vocabulary (drive pack / drive family / diagnostic card / pack provenance); explicitly flags "copilot" as a term to avoid.
- `docs/drive-commander/pack-construction-and-observability.md` — technical ground-truth; honest about gaps (empty `knowledge` block, no per-pack decision trace).
- Recent merged PR chain: #2481 (pack foundation, ADR-0025) → #2482 (TemplateReader) → #2484/#2485 (fault card on both surfaces) → #2486 (DriveDiagnostic object) → #2487 (analog scaling) → #2497 (ParameterCard/KeypadNavigationCard schema) → #2498 (first manual-cited GS10 v2 fixture) → #2499 (wire cards into diagnostic) → **#2501 (ship GS10 pack v2 — CE10→P09.03 live)**.

**Conflicting / outdated positioning (would distract a stranger):**
- `README.md` — the repo front door still pitches a generic "AI-powered maintenance diagnostics / QR→chat→CMMS" chatbot. Highest-visibility, most out-of-date file. Links to `what-is-mira.md` as canonical.
- `docs/product/what-is-mira.md` + `mira_difference_engine_offering.md` + `mira_signal_difference_engine_prd.md` — frame MIRA as a whole-plant **signal difference engine** (2026-06-30). A *second, competing* "sharpening" — broader than and unreconciled with Drive Commander (2026-07-05). ADR-0025 explicitly rejects the general "any machine" framing as unbounded.
- `mira_prd_v2.md` (root) — "Mira HMI Co-Pilot v2.0" (2026-03-31), Ignition-native-first. Archive-grade.
- `docs/adr/0014-product-led-wedge.md` — "maintenance copilot" language NORTH_STAR later bans; still cited by STRATEGY.md as the pricing authority.
- `NORTH_STAR.md` — canonical *wedge* one layer up (context layer / grounded agent), still valid but never narrowed to drives.
- `STRATEGY.md` offer table + `docs/strategy/services-vs-saas-pricing-fork.md` — services ladder ($500/$2-5K/$499) vs $97 self-serve, an acknowledged **unresolved** pricing fork; neither mentions drives.
- The DriveSense PRD is not on `main` — it's on the unmerged docs branch (PR #2494).
- `Mikecranesync/FactoryLM_OS` — **archived 2026-03-11**; ignore.

**Canonical trust order:** ADR-0025 → `CONTEXT.md` glossary → pack-construction doc → `NORTH_STAR.md`.

---

## 3. Current product truth

**Built + genuinely live today**
- **GS10 fault card** — 9 real, `manual_cited` fault entries (`mira-bots/shared/drive_fault_intel.py`), rendered on **both** the engine chat path (`render_machine_evidence`) and the Ignition Ask-MIRA path (`assess_from_paths`), with an inline `Source:` citation.
- **CE10 → P09.03 parameter + view-only keypad card** — **LIVE as of #2501** on both surfaces (was inert until the shipped pack went schema_version 2).
- **`DriveDiagnostic` object** — one source of truth built + consumed identically by both surfaces (no drift).
- **Engine-path analog envelope assessment** — reads the pack envelope directly.
- **Read-only gate** — `test_drive_packs_readonly.py` AST-scans for write-FC/socket/write-name violations with a self-test that proves the checker has teeth.

**Prod-applied on the bench tenant only (not customer-live)**
- The **DC-bus analog card** on the Ignition wire path is gated on a `tag_entities.scaling` row. Timeline (verified via `gh run list`): a 04:27 prod dry-run failed, then at **09:57/09:59 UTC 2026-07-06 the prod dry-run + apply both SUCCEEDED**, landing a `verified` scaling row in **prod** `tag_entities` for the **bench tenant `e88bd0e8…`** (Mike's own tenant, **not a paying customer**). `#2495` is merged. So: **prod-applied on the bench tenant, not "live for customers"** (there are none yet).

**Missing**
- **Drive intelligence from a text/chat message** — `resolve_pack`/`build_cards`/`build_drive_diagnostic` have no caller in `engine.py`. A technician texting "GS10 fault 21" with no live connection gets nothing from the packs. Drive intelligence today requires a **live** snapshot/wire form. (The channel text→pack bridge, #3, would close this.)
- **Nameplate/photo → pack** — `resolve_pack_from_vision` exists + is tested but is **dormant** (no production caller).

**Risky / trust-breaking → mitigated**
- OT-write trust story **holds**: all Modbus-write tools (`plc/live_monitor.py`, `plc/live-plc-bridge/bridge.py`) carry BENCH-ONLY banners and appear in no customer compose.

**Adjacent good news (beta readiness)**
- The **stranger-beta gate PASSES**: `tests/beta/beta_ready_upload_retrieval_citation.py` is a real enforced assertion (xfail removed 2026-06-17) — a stranger uploads their own manual and gets a cited answer with no manual fixing.
- Per-answer **groundedness is computed** (`citation_compliance.py`) but **not surfaced** in the general reply (#2448 P1). For the *drive* path this matters less — the cards already print `Source:`.

---

## 4. Recommended GTM

- **Product name:** Drive Commander (working; branding is an open decision — §8). Codename in-repo: "DriveSense."
- **One-line pitch:** "Turn networked-drive faults into cited, read-only technician next steps on a phone — using the OEM manual, without writing to the PLC or drive."
- **Target user:** the maintenance/controls tech standing at a faulted VFD with a phone.
- **Target buyer:** maintenance/reliability lead at a plant with a DURApulse (GS-family) drive fleet.
- **First design partner:** a small/mid plant running DURApulse GS10s, one champion tech, willing to hand over one manual + one recurring fault.
- **First offer:** the "Machine Context Audit for Drives" (§5).
- **What they get:** drive family identified, its OEM manual ingested, a structured fault-code map, key parameters + view-only keypad guidance where supported, cited fault explanations, and a reusable Machine Context Pack — all read-only.
- **What they do NOT get yet:** whole-plant coverage, live control/automation, predictive failure, multi-vendor (GS10 first), a native app, or a UI-surfaced groundedness score.

---

## 5. Drive Commander beta package (GS10)

- **Supported drive family:** DURApulse GS10 (now v2 — CE10→P09.03 live).
- **Required customer inputs:** the drive family/model; the OEM manual (or confirm we fetch it); one real recurring fault; optionally a live Ignition/OPC-UA/MQTT feed for live evidence (not required for fault/parameter explain).
- **Setup workflow:** fetch/ingest the manual → build/curate the drive pack → validate answers → approve.
- **Technician workflow:** state the fault → get (1) drive/family identified, (2) fault meaning, (3) related parameter + what it means, (4) safe **view-only** keypad steps, (5) next physical check, (6) manual citation + honesty tier.
- **Definition of done (beta):** for a drive/fault we did NOT pre-seed, the loop returns a cited, read-only diagnosis a tech would trust — no manual fixing, no PLC/drive writes.

---

## 6. 30-day execution plan

**Week 1 — flip the wedge from inert to live *(DONE — #2501)***
- Upgrade shipped GS10 pack → v2; PR E live proof (folded in); confirm the `Source:` citation renders.

**Week 2 — one honest technician entry path**
- **[code] Channel-native text → pack bridge** (#3, shared-engine service; text fault-code EXPLAIN, gate-free) — a stranger with a phone and no live connection can use it. Telegram/Slack stay thin. *(Alternative: nameplate photo → pack.)*

**Week 3 — foreign-drive proof + package *(IN PROGRESS)***
- **[proof] Run the loop on a drive we did NOT seed** — the PowerFlex 525 pack, via the reusable manual→pack extractor (PR-A #2503 → PR-B pack). This IS the decision filter.
- **[docs] Assemble the "Machine Context Audit for Drives" offer** as a repeatable runbook.

**Week 4 — demo + front-door truth + first partner**
- **[demo] Record the 3 videos** (fault / parameter / phone moment; emphasize no writes).
- **[docs] Fix the front door** — README + a single canonical "what is MIRA/Drive Commander" answer; mark the competing/stale docs superseded (§7).
- **[gtm] Line up the first design partner** (DURApulse-fleet plant).

---

## 7. Stop / pause list

- **Whole-plant "signal difference engine" generalization** — competes with and dilutes the drive wedge; ADR-0025 rejects "any machine" first. *Pause the framing; don't delete the capability.*
- **Copilot positioning** (`README.md`, `mira_prd_v2.md`, ADR-0014) — the category we lose on distribution.
- **New chat adapters** — 8 already exist; the gap is the *service behind* them, not more front doors.
- **Dashboard / Hub polish** not on the drive workflow.
- **Historian / trending epic (#2338/#2339)** — valuable later, not wedge-critical now.
- **mira-pipeline unit-test bootstrap (#2449)** — quality debt; defer unless it blocks the live-chat demo.
- **Whole-plant UNS expansion** — not before one drive works end-to-end.
- **Any OT write capability** — never; it kills the entire trust story.

---

## 8. Open decisions for Mike

- **Branding:** DriveSense vs **Drive Commander** vs MIRA DriveSense. (Repo/ADR say Drive Commander; handoffs say DriveSense.)
- **First family after GS10:** PowerFlex 525 (ADR-0025's stated next — now in progress) vs staying GS-family (GS20/GS21) for faster reuse.
- **Pricing:** the unresolved services-ladder ($500/$2-5K/$499) vs self-serve ($97/mo) fork.
- **Beta motion:** service-audit vs self-serve vs design-partner. *Recommendation: design-partner first — the loop is proven in code but unproven with a stranger's drive.*
- **First demo modality:** live-connection (needs the bench) vs text-message (needs the #3 bridge).

---

## 9. Claude Code follow-up task list (PR-sized)

**Code** *(flagged where they touch safety/OT/prod)*
1. ~~**Upgrade shipped GS10 pack → v2** + read-only allowlist~~ — **DONE (#2501, live in prod).**
2. ~~**PR E — live CE10→P09.03 proof**~~ — **folded into #2501.**
3. **Channel-native text→pack bridge** — shared-engine service; text fault-code EXPLAIN, gate-free. ⚠️ *Touches engine intent routing; keep the UNS chat-gate carve-out (general fault-code Q = gate-free).*
4. **Wire `resolve_pack_from_vision`** into the photo/vision pipeline. ⚠️ *Vision path; keep read-only.* (Alternative to #3 for the demo modality.)
5. **#2448 — surface citation metadata to the reply UI** (broader groundedness; lower priority — drive cards already cite inline).
6. **PowerFlex 525 extractor + pack** — the reusable manual→pack compiler (PR-A #2503) then the real pack (PR-B). *(In progress.)*

**Docs-only**
7. **Rewrite `README.md`** front-door → Drive Commander wedge; link ADR-0025/CONTEXT, not `what-is-mira.md`.
8. **Reconcile the two "sharpenings"** — one canonical "what is MIRA / Drive Commander" answer; mark `mira_prd_v2.md`, ADR-0014, and the difference-engine framing **superseded**.
9. **Land a customer-facing product doc on `main`** — merge/rebase the DriveSense PRD (PR #2494) or fold its essence into ADR-0025.
10. **Sharpen the DC-bus "live" claim** (`CHANGELOG` v3.73.2) — prod-applied on the **bench tenant** 2026-07-06; **not customer-live** (no customers yet). Also correct ADR-0025's aspirational "PF525 already in KB."

**Safety/OT/auth/prod flags:** #1 (shipped pack → live behavior; done), #10 (prod-data claim), and the DC-bus prod activation (prod-applied on bench, not customer-live).

---

## My recommendation

```
Sell:            Drive Commander — read-only VFD fault + parameter troubleshooting,
                 cited to the OEM manual, on a phone. First family: DURApulse GS10.
To:              Maintenance/reliability techs at plants with a DURApulse GS-fleet.
First proof:     CE10 → P09.03 — cited fault + view-only keypad steps, LIVE (#2501).
Stop building:   Whole-plant difference engine, copilot framing, new chat adapters,
                 dashboards, historian epic, ANY OT write.
Next PR:         PowerFlex 525 pack via the reusable extractor (PR-A #2503 → PR-B) —
                 prove the loop generalizes to a drive we did NOT seed.
Next demo:       "The fault" — CE10 explained with its manual citation (live today).
Beta gate:       The drive-specific version of the already-passing stranger gate —
                 a drive we did NOT seed → cited, read-only diagnosis a tech trusts.
```

**The one-sentence honest truth:** the wedge is right, the runtime is now real (CE10→P09.03 is live in prod as of #2501), and the remaining risk is *generalization* — which the PowerFlex 525 pack, built through the boring evidence-backed compiler, is designed to retire.
