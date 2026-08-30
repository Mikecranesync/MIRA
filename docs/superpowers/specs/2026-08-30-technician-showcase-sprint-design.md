# FactoryLM Technician Showcase Sprint Design

**Status:** Approved by Mike Crane on 2026-08-30  
**Sprint owner:** Mike Crane  
**Implementation:** Claude Code, directed and independently reviewed by Codex  
**Deploy truth:** `origin/main` at `6250dd442` (PR #3480 merged)  
**Primary contract:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md`  
**Product contract:** `docs/prd/2026-08-25-technician-copilot-prd.md`

## 1. Outcome

Build the one-minute technician proof:

> Photograph the problem. Get a safe, cited answer in under 60 seconds.

A technician with no prior setup must be able to open FactoryLM Technician beside an unfamiliar
machine, photograph a nameplate or fault display, confirm the proposed identity, receive an honest
answer with its evidence basis, open the exact cited passage, ask a follow-up or receive a
provider-free refusal, and preserve the outcome in that machine's existing Notebook/Machine Memory.

The sprint ends with synthetic proof and human field-validation readiness. A human technician or
design-partner validation claim remains Mike-gated and may not be inferred from synthetic results.

## 2. Product hierarchy

FactoryLM presents one technician product:

```text
FactoryLM Technician
    |
    +-- MIRA: conversational intelligence and safety policy
    +-- Notebook: the evidence workspace and conversation record
    +-- Drive Commander: the first paid VFD expertise pack
    +-- Sensor: visual and bounded live/replay observations
    +-- Machine Memory: durable equipment history
```

These names describe capabilities inside one experience. The technician is not asked to choose
among separate products before asking for help. FactoryLM's maintenance-context layer remains the
platform and manager-level story; the technician-facing promise is the one-minute result.

## 3. Approved decisions

1. **Primary user:** an industrial maintenance electrician troubleshooting VFDs.
2. **Buyer:** the maintenance manager; the technician is the daily user and internal champion.
3. **Reference equipment:** DURApulse GS10 for bench truth and PowerFlex 525 for external familiarity.
4. **Distribution:** a private, release-signed Android beta first. Play Store work proceeds in
   parallel but does not block field validation.
5. **Evidence scope:** manual evidence and truthful replay are guaranteed. Real live evidence joins
   only when freshness, quality, provenance, and equipment identity are all proven.
6. **Commercial shape:** preserve the existing `$29/month` and `$197/year` individual offer as a
   low-friction demand test. Team/design-partner terms are a later Mike decision after field sessions.
7. **No control:** FactoryLM Technician never writes to a PLC, drive, SCADA, or other OT endpoint.

## 4. Experience contract

### 4.1 Entry

- Asking is immediately available; no notebook, asset, source, or wizard is a prerequisite.
- The primary actions are **Ask** and **Camera**.
- Camera means camera. A gallery/file chooser is a separate, honestly labelled action.
- A technician may remain in general mode, but a machine-specific claim requires confirmed identity
  and machine evidence.

### 4.2 Identity

- A nameplate or fault-display capture produces candidate evidence, never auto-verified truth.
- MIRA proposes manufacturer, family/model, and visible fault code when supported.
- The technician explicitly confirms or corrects the candidate before machine-specific diagnosis.
- GS10 and PowerFlex 525 reuse the existing Drive Commander pack and identity seams. This sprint
  does not create a second OCR, pack, retrieval, inference, or identity pipeline.

### 4.3 Answer

The first machine-specific result exposes, in this order:

1. **What happened** — concise fault/state interpretation.
2. **What changed** — bounded replay/live observation only when trustworthy; otherwise an explicit
   unavailable state.
3. **Safe first check** — grounded in approved evidence and never framed as energized work.
4. **Why MIRA thinks this** — evidence basis, source identity, and exact citation target.
5. **Confidence/trust state** — derived from the existing evidence contract, never decorative.

Unsupported grounded questions return `insufficient_evidence`, zero citations, and no provider
usage. General reasoning is an explicit per-turn mode and is labelled after reload.

### 4.4 Citation

- Tapping a citation opens the exact source target available from the existing citation contract.
- Document, page/passage identity, tenant boundary, and supersession mapping remain intact.
- A successful answer with an unopenable or wrong citation does not pass the sprint.

### 4.5 Continuity

- The phone sends bounded conversation history through the existing conversation seam.
- The evidence-basis label survives reload and cross-device rendering.
- Saving the outcome uses the existing Notebook/Machine Memory stores. No parallel conversation or
  machine-memory database is introduced.

## 5. Machine Memory truth

Machine Memory must distinguish:

- **live:** fresh, trusted observations with quality and age;
- **replay:** a bounded historical window, never labelled live;
- **stale/unavailable:** present but not trustworthy for a live claim;
- **empty:** no observations in the requested window.

The UI may offer Ask MIRA only when the context admission contract can be satisfied. Internal field
names such as `_stale_s` never appear in technician copy. CV-101 remains the bounded synthetic
observer; it does not authorize a general production-live claim.

## 6. Industrial safety and trust

- Safety-keyword detection precedes troubleshooting.
- Immediate safety phrases produce STOP + hazard category + relevant standard + escalation or
  verified-isolation choices.
- A safety STOP cannot silently resume troubleshooting without a fresh, non-safety message.
- PLC/drive interactions remain read-only, including during safety conversations.
- Normal UI is muted. Green, amber, red, and gray communicate actual state only; the action accent
  never masquerades as equipment or evidence status.
- Every displayed live value includes actual value, units when known, quality, freshness, and
  provenance. Unknown values remain unknown.

## 7. Sprint lanes and file ownership

The sprint is split into independently reviewable lanes. Parallel writers may not share files.

1. **Lane C — Machine Memory truth and operation.** Owns Workstream C files and its seven-day
   synthetic observation evidence.
2. **Lane D — Android credibility.** Owns Workstream D camera and response-contract files.
3. **Lane E — Synthetic technician gate.** Owns persona, journey, reporting, and cleanup harnesses.
4. **Lane S — Integrated showcase.** Starts only after C/D/E interfaces are reviewed. It composes
   existing capabilities and may not fork their implementations.

Every lane uses its own worktree and branch, starts at current `origin/main`, follows TDD, commits
frequently, opens one merge-ready PR, and stops for Codex's independent spec and quality reviews.
Mike alone merges.

## 8. Acceptance

### 8.1 Release-blocking

- PR #3480 remains merged and its production-equivalent beta gates remain green.
- Workstreams C and D satisfy their PRD exit gates.
- Five isolated synthetic personas complete the Workstream E journey twice consecutively.
- Supported manual-only questions produce a cited answer whose source target opens correctly.
- Unsupported grounded questions refuse provider-free with no citations.
- Safety cases STOP and escalate; no unsafe next action is emitted.
- Tenant isolation and run-owned cleanup pass.
- The end-to-end synthetic journey records elapsed time, with the one-minute product target reported
  honestly rather than forced into a passing assertion before human validation.

### 8.2 Human-gated

- Mike installs the release-signed Android build on physical hardware.
- Mike recruits and observes five technicians without coaching.
- Mike authorizes production credentials, production probe dispatch, deployments, and merges.
- Only human sessions may establish usability, willingness-to-pay, or design-partner-readiness
  claims.

### 8.3 Field measurements

For each human session record:

- time to first useful result;
- identity correctness and corrections;
- citation correctness and successful opening;
- comprehension and trust response;
- abandonment/confusion point;
- intent to use on the next shift;
- willingness to introduce the product to a maintenance manager.

## 9. Explicit non-goals

- A sixth navigation tab, a second chat surface, or an upfront onboarding wizard.
- A second inference cascade, safety classifier, evidence model, retrieval stack, ingest pipeline,
  identity system, conversation store, or Machine Memory store.
- New product families unrelated to the VFD-first proof.
- Broad ChatGPT-parity polish outside the journey.
- New Sensor or PrintSense features that do not materially improve the approved flow.
- Generic dashboards or decorative HMI work.
- Any PLC/drive control, reset, parameter write, or state-changing service.
- A production, human-design-partner, or willingness-to-pay claim made from synthetic evidence.

## 10. Delivery and review

Claude implements bounded lanes from the task plans. Codex retains independent adversarial review,
runs the relevant verification commands itself, checks exact-head evidence, and rejects scope drift
or false completion claims. Each PR includes before/after evidence appropriate to its surface,
explicit test commands, and a HANDOFF record. A lane is complete only when its specification and
quality reviews pass and no required work remains.
