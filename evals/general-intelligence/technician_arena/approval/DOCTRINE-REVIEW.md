# Doctrine approval packet — General Intelligence Preservation

**Review this first.** It is one of the two human gates on PR #3487 (the other is the answer keys,
`ANSWER-KEY-REVIEW.md`). Nothing here approves anything. The decision block at the end is blank on
purpose.

| | |
|---|---|
| PR | Mikecranesync/MIRA #3487 (`codex/general-intelligence-gi1`) |
| Reviewed commit | `cdf7ae8567fe7a3940e473007017fafdf17035db` (descends from `686c28bfe`, the round 3 fix) |
| Doctrine file | `.claude/rules/general-intelligence-preservation.md` |
| Doctrine sha256 | `689ed97e0dda1054189efbacb20d52751daa3dc6c8ec4f00cf6084b8fb3d9365` |
| Doctrine history | one commit, `62329856a` (2026-08-30); unchanged since |
| Also under review | the one-line pointer at `.claude/CLAUDE.md:180` (same PR) |
| Reviewer expected | Mike Harper |

The sha256 above is what approval binds to. If the file changes by one byte, this packet no longer
describes it and the decision must be re-made.

**What approving it would mean in practice.** This file is a `.claude/rules/` rule. Every Claude and
Codex session in the repository loads it, and reviewers will reject PRs against its checklist. It
changes how agents build and review MIRA. It does not change any running code and does not by itself
authorize any paid benchmark run.

---

## Contents

1. [The doctrine, section by section](#1-the-doctrine-section-by-section)
2. [Conflicts with existing doctrine and the codebase](#2-conflicts-with-existing-doctrine-and-the-codebase)
3. [Undefined terms and loopholes](#3-undefined-terms-and-loopholes)
4. [Where reasonable reviewers could disagree](#4-where-reasonable-reviewers-could-disagree)
5. [What the evidence does and does not support](#5-what-the-evidence-does-and-does-not-support)
6. [HUMAN DECISION](#6-human-decision)

Each rule in section 1 has five parts: the verbatim text, what it means in plain English, the
behaviour it is meant to enforce, PASS and FAIL examples, and the issues specific to that rule.
Issues that cut across rules are in sections 2–4.

---

## 1. The doctrine, section by section

### Header (verbatim)

> Source: MIRA General Intelligence Parity build plan (2026-08-30) §35; current-state map
> `docs/architecture/general-intelligence-parity-current-state.md`; benchmark
> `evals/general-intelligence/`.

**Note.** The build plan it names as its source is not in the repository. Only the current-state
map is. Approving the rule approves text whose origin document cannot be read from here.

---

### R1 — General Intelligence Preservation Rule (verbatim)

> MIRA is a general multimodal assistant first and a FactoryLM-aware assistant second.
> FactoryLM context, retrieval, machine evidence, modes, and tools may add knowledge,
> provenance, constraints, and actions, but must not unnecessarily reduce the capabilities
> of the configured frontier model. No general user question may be rejected solely
> because private FactoryLM evidence is absent unless answering the requested claim would
> require pretending to possess asset-specific evidence. Every material orchestration
> change must be evaluated against the raw configured frontier-model baseline.

The paragraph contains four separable rules.

#### R1a — "general multimodal assistant first, FactoryLM-aware second"

- **Plain English:** MIRA should be at least as broadly useful as the model under it. The FactoryLM
  layer is an addition, not the identity.
- **Behaviour it enforces:** priority when the two pull apart. If a FactoryLM feature would make MIRA
  less helpful on an ordinary question, the ordinary question wins.
- **PASS:** a technician asks "what's a good torque spec for an M8 grade 8.8 bolt?" in a blank chat
  and gets a normal answer.
- **FAIL:** the same question gets "I can only answer questions about your approved assets."
- **Issue:** this sentence directly contradicts `.claude/CLAUDE.md:27` and `:200`, and the
  positioning line in root `CLAUDE.md:11` (see C1). It is a **positioning statement**, not only an
  engineering rule. It is the sentence most likely to need changes.

#### R1b — "may add … but must not unnecessarily reduce the capabilities of the configured frontier model"

- **Plain English:** wrapping the model in retrieval, gates, modes and tools must not make it dumber
  than it would be on its own, unless there is a reason.
- **Behaviour it enforces:** every gate, prompt constraint or mode has to justify what it takes away.
- **PASS:** a machine-bound notebook adds citations from the drive manual to an answer the model
  would have given anyway.
- **FAIL:** a mode prompt forces a fault-code intake questionnaire before answering "what does DC
  bus overvoltage usually mean?"
- **Issue:** "unnecessarily" carries all the weight and is undefined (see L1). "Configured frontier
  model" is also ambiguous: production runs `gpt-oss-120b` today, and the arena pins `gpt-5.5`
  (see C5).

#### R1c — "No general user question may be rejected solely because private FactoryLM evidence is absent, unless answering would require pretending to possess asset-specific evidence"

- **Plain English:** missing documents are not a reason to refuse a general question. The only
  permitted refusal is when the answer would have to fake knowledge about this particular machine.
- **Behaviour it enforces:** no "upload a manual first" wall on general questions.
- **PASS:** "why would a motor run hot at low VFD speed?" in a notebook with no sources: answered from
  general knowledge, labelled as general.
- **PASS (the carve-out):** "how many times has *this* drive tripped this month?" with no history:
  "I don't have this machine's fault history" is correct, because answering would require pretending.
- **FAIL:** "what does F005 mean on a PowerFlex 525?" refused because no 520-UM001 is uploaded.
- **Issue:** this is in live conflict with the owner decision behind #4069 (merged): a machine-bound
  notebook with nothing citable "leans to declining", and "occasionally declining a general question
  is the accepted residual" (C3). The rule's wording is absolute ("No … may be rejected"). The #4069
  decision accepts a known error rate in the opposite direction. One of the two has to give.

#### R1d — "Every material orchestration change must be evaluated against the raw configured frontier-model baseline"

- **Plain English:** a change to how MIRA builds an answer has to be compared against the bare model.
- **Behaviour it enforces:** no "the tests pass so it's smarter" merges.
- **PASS:** a PR that changes the retrieval prompt attaches an arena before/after.
- **FAIL:** the same PR merges on unit tests alone.
- **Issue:** see C5 (which baseline is valid) and C7 (cost of the evaluation). "Material" is
  undefined (L2).

---

### R2 — Evidence Truth Rule (verbatim)

> General knowledge may be answered from model reasoning and public evidence. Private
> document claims require private document evidence. Asset-specific historical/live claims
> require machine evidence. The absence of one evidence class must not suppress unrelated
> answerable portions of the user's request.

#### R2a — general knowledge from model reasoning and public evidence

- **Plain English:** it is fine to answer from what the model knows, or from public sources.
- **PASS:** "coast-to-stop lets the load decelerate on its own" with no citation, labelled as general.
- **FAIL:** the same statement shown with a citation chip pointing to a customer upload that doesn't
  say it (a cosmetic citation).
- **Issue:** "public evidence" assumes a web or public-citation path. The current-state map says none
  exists in the conversation today (`general-intelligence-parity-current-state.md`: `search_web` is
  a Phase 3 disposition). The rule permits something the product cannot yet do, which is harmless.
  It does mean a reader cannot check the "public evidence" half against current behaviour.

#### R2b — private document claims require private document evidence

- **Plain English:** if MIRA says "your manual says X", it must actually have that manual and passage.
- **PASS:** "per 520-UM001 p. NN, F005 is DC bus overvoltage" with that page in the notebook.
- **FAIL:** "your manual recommends 10 s decel" with no such passage.
- **Issue:** none found. This matches existing citation doctrine (`.claude/CLAUDE.md` § Grounded
  troubleshooting).

#### R2c — asset-specific historical/live claims require machine evidence

- **Plain English:** "this drive tripped three times last week" needs work-order or telemetry data.
- **PASS:** "I don't have this drive's history. Here is what usually causes repeat F005s."
- **FAIL:** "This drive has tripped like this before" with no history source (the arena case
  `ta-followup-bound-history` tests exactly this).
- **Issue:** none found. This is consistent with Workstream C (#3486) invariants restated in R4.

#### R2d — the absence of one evidence class must not suppress unrelated answerable portions

- **Plain English:** answer the parts you can; decline only the part you can't.
- **PASS:** "has this drive tripped before, and what else should I try?" gets "history unavailable;
  here's what to try next."
- **FAIL:** the whole turn is refused because the history half can't be answered.
- **Issue:** this is the most testable rule in the file and the one the arena measures most directly.
  A reviewer could reasonably ask whether a mixed answer's layout (general part first vs.
  limitation first) matters for a technician on a phone; the rule does not say.

---

### R3 — Benchmark Rule (verbatim)

> A feature is not considered an intelligence improvement merely because its tests pass.
> For behavior that affects answer generation, compare MIRA against the raw configured
> frontier model on representative benchmark cases and investigate meaningful regressions
> before merge.

- **Plain English:** unit tests prove plumbing, not intelligence. Answer-affecting changes need a
  side-by-side against the bare model, and regressions have to be looked at before merging.
- **Behaviour it enforces:** a before/after benchmark as a merge precondition for answer-path work.
- **PASS:** a gate change ships with an arena run showing no new refusals on general cases.
- **FAIL:** a gate change ships with "all 40 tests green" and nothing else.
- **Issues:**
  - "Meaningful regressions" is undefined (L3). There is no threshold, and live-inference evals vary
    from run to run, so a small delta may be noise. This packet did not measure that noise.
  - "Investigate … before merge" requires an investigation, not a fix. A regression can be
    investigated and merged anyway. That may be intended; it is a real loophole if not (L4).
  - It compares against the "raw configured frontier model". The harness this PR ships says that
    comparison is confounded and that only `raw-same-model` isolates the wrapper (C5).

---

### R4 — "What this does NOT relax" (verbatim)

> - Workstream C machine-memory invariants (`PR #3486`): replay CTA gated on admissible
>   coverage; unavailable ≠ empty; no false "Live"; canonical condition titles; route-level
>   refusal for an *explicitly requested* empty/unavailable machine-history claim; preflight;
>   observer; tenant isolation; read-only equipment. An explicit machine-history claim may
>   still get a precise "unavailable/empty" result — but the general parts of the same
>   question are answered.
> - Provider policy: Groq → Cerebras → Together cascade; OpenAI models permitted **behind the
>   seam** (owner decision 2026-08-26); **Anthropic excluded** from diagnosis; paid inference
>   is validation, never a dev/debug tool (`zero-token-architecture.md`).
> - Security: tool authorization, tenant isolation, read/write distinction, and mutation
>   confirmation live in code, never in the prompt.
> - One conversation store, one evidence model, one canonical seam — new evidence kinds
>   (web, machine history) extend `evidence[]`; they never create a second store or route.

#### R4a — Workstream C invariants stay

- **Plain English:** "general first" doesn't loosen any of the machine-memory honesty rules.
- **PASS:** a question asking for live values on a machine with no live feed says "no live data".
- **FAIL:** a "Live" badge shown on replayed data to seem more capable.
- **Issue:** `PR #3486` is cited as the source of the invariants. This packet did not re-verify that
  #3486's final merged content matches the list. The reviewer may want to.

#### R4b — Provider policy

- **Plain English:** the free cascade stays, OpenAI may be used behind the one model seam, Anthropic
  stays out of diagnosis, and paid inference is only for validation.
- **PASS:** a future `MIRA_FRONTIER_MODEL=gpt-…` resolved inside the seam.
- **FAIL:** a second provider client called directly from a route.
- **Issue — significant:** the "owner decision 2026-08-26" permitting OpenAI is recorded only in
  **PR #3408, which is still open and unmerged** (`docs/decisions/2026-08-26-technician-copilot-owner-decisions.md`
  at `06c7d6527`, lines 18–26), plus a restatement in this PR's own current-state map. Root
  `CLAUDE.md:29`, **Hard Constraint #2**, still lists only Groq + Cerebras + Together (C2). Approving
  this rule as written would make a `.claude/rules/` file assert a policy that the repository's hard
  constraints do not yet contain. **This is the one place in the doctrine that would change provider
  policy by reference rather than by editing the constraint itself.**

#### R4c — Security lives in code, not prompts

- **PASS:** tenant scoping enforced in SQL; the prompt never "asks" the model to stay in-tenant.
- **FAIL:** "Only answer about tenant X" in a system prompt as the isolation mechanism.
- **Issue:** none found. This is consistent with `security-boundaries.md`.

#### R4d — One store, one evidence model, one seam

- **PASS:** web citations added as a new `kind` inside `evidence[]`.
- **FAIL:** a separate "web answers" table and route.
- **Issue:** none found. This is consistent with `materialized-evidence.md` rule 15.

---

### R5 — "When this applies" (verbatim)

> - Any change to a chat/answer route, gate, mode, provider seam, citation contract, or
>   image pipeline; any PR that adds or tightens a refusal.

- **Plain English:** the scope. It is broad, covering most of `mira-hub` chat and `mira-bots/shared`.
- **Issue:** combined with R3 and the checklist item R6d, a large share of MIRA PRs would need a
  benchmark before/after. See C7.

---

### R6 — "What a reviewer must catch" (verbatim)

> - ❌ A turn refused wholesale because private evidence is absent when the model could have
>   answered the general portion.
> - ❌ A new answer path/stack instead of a tool beneath the one conversation engine.
> - ❌ Web/public evidence rendered as private evidence (or vice versa); cosmetic citations.
> - ❌ An answer-generation change merged without a `evals/general-intelligence` before/after.
> - ❌ Authorization delegated to prompt text.

| Item | Plain English | FAIL example | Issue |
|---|---|---|---|
| R6a | refuse only the part you can't answer | whole reply is "upload a manual first" | conflicts with #4069 (C3) |
| R6b | extend the one engine, don't fork it | a new `/api/general-chat` stack | none |
| R6c | label evidence by its true kind | a web page shown as "your manual" | none |
| R6d | benchmark before/after on answer changes | a prompt edit merged with unit tests only | cost and practicality (C7); "a before/after" does not say live vs. dry-run |
| R6e | auth in code | "don't reveal other tenants" in the prompt | none |

**R6d is stricter than R3.** R3 says "investigate meaningful regressions". R6d makes the before/after
itself a reviewer-blocking item for every answer-generation change, with no size threshold.

---

### The `.claude/CLAUDE.md:180` pointer (verbatim, same PR)

> **General Intelligence Preservation** — MIRA is a general multimodal assistant first; FactoryLM
> evidence adds, never suppresses; answer-generation changes are benchmarked against the raw frontier
> model (`evals/general-intelligence/`).

- **Issue (C4):** the pointer is **stronger than the rule it points to**. The rule says "must not
  *unnecessarily* reduce" and permits refusal when answering would mean pretending to have asset
  evidence. The pointer says "adds, never suppresses". Many agents read only the CLAUDE.md summary.
  If the pointer is approved as written, the effective doctrine is the absolute version.

---

## 2. Conflicts with existing doctrine and the codebase

| # | Conflict | Where | Severity |
|---|---|---|---|
| C1 | "general multimodal assistant first" vs. "It is **not** a generic chatbot" and "❌ Build a generic chatbot. MIRA answers grounded maintenance questions, nothing else." | `.claude/CLAUDE.md:27`, `.claude/CLAUDE.md:200` (same file the PR adds the pointer to) | **High.** The same file would carry both statements after merge. |
| C1b | "general … first" vs. "**Lead with the context platform, never the copilot.**" | root `CLAUDE.md:11` / `NORTH_STAR.md` | Medium. Positioning, not engineering. Reconcilable if "first" means capability floor, not marketing lead. The rule does not say that. |
| C2 | "OpenAI models permitted behind the seam (owner decision 2026-08-26)" vs. Hard Constraint #2 (Groq + Cerebras + Together only) | root `CLAUDE.md:29`; the decision record is only in **open PR #3408** | **High.** Changes provider policy by citation to an unmerged document. |
| C3 | "No general user question may be rejected solely because private evidence is absent" vs. #4069 owner decision "**lean to declining** … occasionally declining a general question is the accepted residual" | `mira-hub/src/capabilities/documented-value-question.ts:161–169` on `origin/main` `3aafbf456` | **High.** Live product behaviour contradicts the rule's absolute wording today. |
| C4 | pointer "adds, never suppresses" vs. rule "must not unnecessarily reduce … unless … pretending" | `.claude/CLAUDE.md:180` vs. the rule | Medium. The summary overstates the rule. |
| C5 | Benchmark against "the raw configured frontier model" vs. the harness README: `mira` vs `raw-frontier` "is **confounded**, never scored as a wrapper effect"; only `raw-same-model` is valid | `evals/general-intelligence/technician_arena/README.md` (same PR) | **High.** Read literally, the doctrine mandates the comparison the PR's own harness calls invalid for this purpose. "Configured frontier model" is `gpt-oss-120b` in production (the model MIRA actually runs) but `gpt-5.5` in the arena's `raw-frontier` arm. |
| C6 | "No general question rejected …" vs. the UNS confirmation gate "No confirmed namespace context, no troubleshooting … Even at high confidence, always confirm" | `.claude/rules/uns-confirmation-gate.md`, `.claude/CLAUDE.md` § UNS gate | Medium. The gate already exempts general/educational questions, so most cases are compatible. The grey zone is a model-specific question in a blank chat ("PowerFlex 525 F005, what should I check?"). The gate says confirm first; R1c says answer. PR #3408 would narrow the gate to asset-specific claims, but is unmerged. |
| C7 | R3/R6d before/after on every answer-generation change vs. the zero-token rule "paid inference is a validation instrument … every paid lane declares a budget" | `.claude/rules/zero-token-architecture.md` | Low–medium. Not a contradiction: a before/after *is* a validation. It does imply a paid run on many PRs, and the rule does not say whether a `--dry-run` (which proves plumbing only) satisfies it. |

## 3. Undefined terms and loopholes

| # | Term / gap | Why it matters |
|---|---|---|
| L1 | "unnecessarily" (R1b) | Any gate can be argued necessary. With no test for necessity, R1b is unenforceable as written. |
| L2 | "material orchestration change" (R1d) | No threshold for which changes need a baseline. |
| L3 | "meaningful regressions" (R3) | No threshold. The existing harness has known run-to-run noise. |
| L4 | "investigate … before merge" (R3) | Satisfied by writing down a regression and merging anyway. |
| L5 | "configured frontier model" | Production model, arena model, or a future `MIRA_FRONTIER_MODEL` alias? The alias does not exist yet (current-state map, provider ceiling). |
| L6 | "representative benchmark cases" | The GI-1 corpus has 25 cases and the Technician Arena has 12; neither is declared "the" representative set, and GI-1's keys have no signoff mechanism. |
| L7 | Enforcement | The rule is enforced by reviewers only. No CI check, hook or code path reads it. The approval manifest in this directory is also advisory; nothing reads it (see `README.md`). |

## 4. Where reasonable reviewers could disagree

1. **Identity.** Is MIRA a general assistant with FactoryLM on top (this rule), or a grounded
   maintenance agent that refuses off-mission requests (`.claude/CLAUDE.md:27`/`:200`)? This is a
   product decision, not a drafting error, and both positions are defensible.
2. **The #4069 trade-off.** When classification is uncertain in a machine-bound notebook with no
   sources, which error is worse: answering a documented-value question from general knowledge
   (possible wrong number presented near a machine context), or declining a general question
   (helpfulness regression)? #4069 chose the latter. R1c chooses the former.
3. **Which baseline.** Is the right comparison the product against the best available model (a
   capability question: is MIRA worth using?), or the product against its own model unwrapped (a
   wrapper question: did our layers hurt?)? R3 names the first. The harness author argues only the
   second isolates wrapper harm.
4. **Cost of the before/after.** Is a paid benchmark per answer-affecting PR proportionate, or should
   it be batched per release?
5. **Provider policy by reference.** Should OpenAI permission enter the doctrine before PR #3408 or
   Hard Constraint #2 is updated, or after?

## 5. What the evidence does and does not support

- **Supports:** R2b, R2c, R2d, R4a, R4c and R4d restate or sharpen existing, merged doctrine. This
  packet found no conflicts for them.
- **Does not support approving as written without a decision on:** R1a (C1), R4b (C2), R1c/R6a (C3),
  R3/R1d (C5), and the pointer (C4). Each of these either contradicts merged doctrine, contradicts
  live code on `main`, or relies on an unmerged decision record.
- **This packet does not recommend a decision.** It records where the text is consistent and where
  it is not.

If changes are wanted, the smallest edits that would resolve each conflict are listed below. They are
listed so the decision is concrete. None has been made, and any edit would change the sha256 and
require re-review.

- C1: state in R1a that "general first" means a capability floor, and amend or qualify
  `.claude/CLAUDE.md:27`/`:200` in the same change.
- C2: either land the provider decision in Hard Constraint #2 first, or remove the OpenAI clause
  from R4b until then.
- C3: either carve out the #4069 case in R1c, or reopen #4069's decision.
- C4: make the pointer match the rule ("must not unnecessarily suppress").
- C5: name `raw-same-model` as the wrapper-regression baseline and `raw-frontier` as a capability
  reference.

---

## 6. HUMAN DECISION

Fill in and commit, or record the same fields in `APPROVAL-MANIFEST.json`
(`doctrine.approval`). A decision applies only to the sha256 below.

```
Doctrine file:        .claude/rules/general-intelligence-preservation.md
Doctrine sha256:      689ed97e0dda1054189efbacb20d52751daa3dc6c8ec4f00cf6084b8fb3d9365
Pointer:              .claude/CLAUDE.md:180 (included in this decision: YES / NO)
Reviewed commit SHA:  cdf7ae8567fe7a3940e473007017fafdf17035db

Decision (choose one):
  [ ] APPROVE AS WRITTEN
  [ ] APPROVE WITH CHANGES   (list the changes below; the file must be edited and re-hashed,
                              and approval then applies to the NEW sha256 only)
  [ ] REJECT

Changes required / reviewer notes:



Conflicts C1–C7 considered:  [ ] yes

Reviewer name:
Date (YYYY-MM-DD):
```
