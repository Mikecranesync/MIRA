# Telethon Flight School — implementation plan

**Spec:** `docs/superpowers/specs/2026-08-08-telethon-flight-school-design.md`
**Status:** Phase 0 implemented (`60f420836`, PR #3155). Phases 1–6 planned below.
**Date:** 2026-08-08

Each PR below is independently reviewable, carries its own tests, and leaves the
loop working. None of them requires the next one to land to be worth merging.

---

## Reconciliation — what already exists

The spec was written against an earlier reading of the code. Current state:

| Spec concept | Exists today as | Gap |
|---|---|---|
| Campaign runner | `tests/regime1_telethon/campaign/runner.py` (tiers 1/2/3/8) | tiers 4–7 unimplemented |
| Coverage ledger | `campaign/ledger.py` — append-only JSONL | not an evidence packet; no state/retrieval/tool capture |
| Findings + disposition | `campaign/findings.py` (+ `dispositions.yml`) | `defect_id` exists but there is no defect *registry* |
| Per-run report | `campaign/report.py` | — |
| Consolidated report | `campaign/summary.py` | no dev/regression/holdout split |
| Issue filing | `campaign/issues.py` — deduped, dry-run default | — |
| Evidence durability | `campaign/manifest.py` — SHA-256 manifest | bundle itself is not stored anywhere shared |
| Deterministic grading | `uat_driver.grade_turn` expect/forbid | hard gates are not a separate, enumerated module |
| Semantic judging | `campaign/judge.py` | prompt not versioned; provider not pinned or routed away |
| Personas | `campaign/personas.py` (6) | spec asks for 11; no dialogue-strategy catalog |
| Safety curriculum | none | **nothing in the campaign exercises §9 at all** |
| Adapter parity | none | Telegram only |

Two things worth stating plainly before any of this is scheduled:

- **The safety curriculum (§9) does not exist.** The spec makes it a mandatory
  release gate. It is the single largest gap and it is not in Phase 0. Given the
  read-only/no-PLC-write invariants are load-bearing product claims, this should
  outrank the schema work below.
- **Consent and tenant isolation (§14) block Phase 5 entirely.** No field capture
  should be built until an opt-in and redaction path is designed, and that is a
  product/legal decision, not an engineering one.

---

## Phase 1 — Versioned evidence packets

**PR 1.1 — Packet schema + validator.**
`campaign/packet.py`: a versioned dataclass covering §7 identity/provenance,
conversation, state, evidence, outcome. JSON Schema validation, `schema_version`,
and a migration hook. Ledger keeps writing what it writes; the packet is composed
alongside it. Tests: round-trip, unknown-version rejection, required-field
enforcement, missing-data-is-never-PASS.

**PR 1.2 — Capture engine state.**
The runner sees only the wire. FSM state, resolved UNS path, gate decisions and
extraction live in the engine. Add a read-only debug envelope on the staging
reply path (behind an env flag, off in prod) and record it. This is the PR most
likely to touch `engine.py`; run `codegraph_impact` first and keep it additive.

**PR 1.3 — Capture retrieval and tool provenance.**
Chunk ids, scores, filters, rejection reasons, tool calls and latency.

**PR 1.4 — Redacted manifest.**
Extend `manifest.py` to emit a sanitized packet manifest with content hashes and
parent hashes.

*Exit:* every verdict is explainable from its packet without re-reading a transcript.

## Phase 2 — Scenario catalog, contracts, and the defect registry

**PR 2.1 — Registries.**
`campaign/registry/{scenarios,variants,contracts,defects}.yml` plus loaders.
`defect_id` becomes a foreign key into the defect registry instead of a free
string. Resolves the limitation Phase 0 documented: `t1:reset_procedure` reveals
two defects and cannot currently be labelled honestly.

**PR 2.2 — Hard-gate grader module.**
`campaign/gates.py` implementing §10.1 as deterministic checks that run **before**
any judge and cannot be overridden by one. Start with the gates already provable
offline: uncited claim, cross-vendor contamination, re-asking supplied
information, contradiction without acknowledgement, claiming an unexecuted
scenario passed.

**PR 2.3 — Safety curriculum.** *(highest value in this phase)*
Scenarios for every §9 case, graded by hard gate, wired as a release blocker.
Includes the mixed-message case (legitimate fault question + unsafe request) and
the resume-after-STOP case.

**PR 2.4 — Language and evidence-condition coverage.**
§8.2 and §8.5 as variant generators.

*Exit:* critical behaviour no longer depends on a judge's opinion.

## Phase 3 — Personas, adversarial pressure, repeated runs

**PR 3.1** — persona catalog to the full §8.4 list; dialogue-strategy catalog (§8.3).
**PR 3.2** — risk-weighted / pairwise combination generator (not the Cartesian product).
**PR 3.3** — multi-seed execution (≥5) with consistency, mutation-sensitivity and
repetition metrics. This is what turns "one stochastic pass" into evidence, and it
retires the caveat currently attached to every tier-8 result.

*Exit:* the suite measures behaviour under conversational pressure.

## Phase 4 — Adapter parity and staging qualification

**PR 4.1** — run the same scenario through Slack and Telegram; assert equivalent
engine decisions, evidence, safety behaviour and state transitions.
**PR 4.2** — flagship scenarios (§13) on staging with controlled demo-tenant evidence.
**PR 4.3** — degradation cases (§8.6): embedding down, provider timeout, OCR failure.

*Exit:* demo behaviour is proven to be production behaviour.

## Phase 5 — Human-reviewed field learning *(blocked)*

Do not start before consent, redaction and retention are decided. Then:
opt-in capture → redaction review → structured technician feedback (what was
wrong, what resolved it) → expert-approved corrections → label-agreement
measurement.

## Phase 6 — Optional model adaptation *(gated)*

Only after Phase 3 shows the remaining failures are model-behaviour failures
rather than retrieval, state, data or tool defects. Train only on
`training_approved`; hold out regression and holdout sets; reject adaptation that
weakens grounding, safety or provider portability.

---

## Sequencing recommendation

Not strictly by phase number:

1. **PR 2.3 (safety curriculum)** — the largest correctness gap, and a claim the
   product already makes.
2. **PR 2.2 (hard gates)** — makes the existing suite trustworthy.
3. **PR 3.3 (multi-seed)** — removes the "one run is one sample" caveat that
   currently qualifies every result.
4. **Phase 1** — evidence packets. Valuable, but explanatory rather than
   protective; it makes failures easier to diagnose, not less likely.
5. Phase 4, then 5/6 when unblocked.

## Out of scope

Unchanged: no LangChain/TensorFlow/n8n, no new LLM abstraction, no PLC writes, no
demo-only response path, no cross-tenant evidence. Adapters keep sharing one
engine; the campaign never becomes a second one.
