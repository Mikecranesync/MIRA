# Drive Commander — Capability Matrix

**Verified 2026-07-20 against `origin/main` (`5fa32cb8`).** Status legend:
**PRODUCTION** (served + tested + real data) · **BETA** (served, manual-cited, no bench data / trust
ceiling = beta) · **PARTIAL** (works with caveats) · **FIXTURE-ONLY** (test scaffolding, not shipped)
· **DORMANT** (built + tested, not wired) · **ABSENT** (not present) · **UNKNOWN**.

> **Do not inflate from schema existence or docs.** A schema field, a staged candidate, or a public
> web page is **not** a runtime capability. Only three packs are runtime-servable.

## Families in scope

| Family | pack_id | Where | Status |
|---|---|---|---|
| **DURApulse GS10** | `durapulse_gs10` | runtime | PRODUCTION (bench+manual, gold reference) |
| **PowerFlex 40** | `powerflex_40` | runtime | BETA (manual-cited, Mike-approved 2026-07-09) |
| **PowerFlex 525** | `powerflex_525` | runtime | BETA (manual-cited) |
| Siemens G120 | — | **public web only** | NOT RUNTIME (cited web page; was fabricated→rebuilt) |
| Magnetek IMPULSE G+ Mini | — | **staged candidate** | NOT PROMOTED (only true mnemonic dataset) |
| GS20 / PowerFlex 400 / others | — | — | ABSENT (failed extraction / KB chunks only) |

## The matrix (runtime families)

| Capability | GS10 | PowerFlex 40 | PowerFlex 525 |
|---|---|---|---|
| Family id from text | **PRODUCTION** | **PRODUCTION** | **PRODUCTION** |
| Family id from photo/keypad | **PARTIAL** (model nameplate extract → deterministic match) | **PARTIAL** | **PARTIAL** |
| OCR fault-code extraction | **PRODUCTION** (digit-bearing) / **PARTIAL** (pure-letter excluded by design) | **PRODUCTION** (numeric+context) | **PRODUCTION** |
| Numeric fault codes | **PRODUCTION** | **PRODUCTION** (26) | **PRODUCTION** (48) |
| Mnemonic/alphanumeric fault codes | **PARTIAL** (digit-bearing `CE10` full; pure-letter `GFF/oL/EF` explicit-only, not OCR-extracted; **case flattened `oC≡OC`**) | **ABSENT** (English names, no mnemonic) | **ABSENT** |
| Fault meaning | **PRODUCTION** (10) | **PRODUCTION** (26) | **PRODUCTION** (48) |
| Likely causes | **PRODUCTION** (9 codes via `drive_fault_intel`) | **ABSENT** (empty — no injected reader) | **ABSENT** |
| Safe technician checks | **PRODUCTION** (9 codes, "VIEW-ONLY" prefixed) | **ABSENT** | **ABSENT** |
| Reset guidance | **PARTIAL** (only if a matched param/fault text mentions it; no reset handler) | **PARTIAL** | **PARTIAL** |
| Parameter lookup | **PRODUCTION** (8, cited) | **BETA** (9) | **BETA** (45) |
| Parameter units/scaling | **PRODUCTION** | **PARTIAL** (some null; `value_meanings` enums) | **PARTIAL** |
| Keypad navigation | **PRODUCTION** (4 cards, view-only-warned) | **ABSENT** (`[]`) | **ABSENT** (`[]`) |
| Status-word interpretation | **PRODUCTION** (bench_verified; data-only, no ask.py handler) | **ABSENT** (`{}`) | **ABSENT** (`{}`) |
| Command-word interpretation | **PRODUCTION** (data-only) | **ABSENT** | **ABSENT** |
| Wiring/terminal guidance | **ABSENT** (not in pack schema) | **ABSENT** | **PARTIAL** (verbatim manual ATTENTION notes on safety params only) |
| Source citations | **PRODUCTION** (per-code via reader) | **PARTIAL** (pack-level list stapled to every card — not per-fault) | **PARTIAL** (same; all 48 sources per card) |
| Exact manual + revision provenance | **PRODUCTION** (Rev B, dual sha256, public CDN) | **PRODUCTION** (Rev J, sha256, public URL) | **PRODUCTION** (Rev O, sha256, public URL) |
| Confidence | **PARTIAL** (param/keypad `confidence_tier` band; fault `DiagnosticCard.confidence` hardcoded `None`) | **PARTIAL** (`provenance_tier` only) | **PARTIAL** |
| Honest decline | **PRODUCTION** (`answer_source="none"`, never guesses) | **PRODUCTION** | **PRODUCTION** |
| Deterministic lookup | **PRODUCTION** | **PRODUCTION** | **PRODUCTION** |
| LLM fallback (inside pack path) | **ABSENT by design** (falls through to engine RAG on miss; pack path never calls a model) | same | same |
| Feedback capture | **PARTIAL** (misses → `conversation_eval` → gap flywheel; no thumbs-up capture; human-gated) | **PARTIAL** | **PARTIAL** |
| Pack versioning | **PRODUCTION** (schema_version 2; provenance tiers; hash-pinned) | **PRODUCTION** | **PRODUCTION** |
| Tests | **PRODUCTION** (truth-pins 9/9 faults + 8/8 params; anti-drift vs `live_snapshot`) | **PRODUCTION** (cite 35✓/0✗, recall 100%) | **PRODUCTION** (cite 93✓/0✗, recall 97%, 3 residuals) |
| Deployment | **PRODUCTION** (all bot envs; `/drive-pack/ask` prod) | **PRODUCTION** | **PRODUCTION** |

## Cross-family, capability-level status (platform capabilities, not per-family)

| Capability | Status | Note |
|---|---|---|
| Mnemonic-KEYED fault schema (`fault_entries` v3, `oC`≠`OC`, per-fault citation) | **DORMANT** | schema + loader + tests exist and pass; **consumed by ZERO answer/card code** — unreachable at runtime (see baseline defect D1) |
| Read-only enforcement (static + structural + output) | **PRODUCTION** | AST gate teeth-proven; no connector exists yet |
| Rich multi-signal photo→answer (`shared/visual/`) | **DORMANT** | built + tested, wired to nothing |
| Live-telemetry decode (`live_snapshot.py`) | **PRODUCTION** (GS10 only has the data) | PF40/525 have empty `live_decode` |
| Manual→candidate bridge + gap flywheel + grader | **PRODUCTION** (offline/human-gated) | never auto-promotes |
| LOTO/arc-flash explicit safety layer in answers | **ABSENT** | safety is structural (view-only/no-writes), not keyword-driven |

## Honest headline

- **GS10 is the only "complete" family** — faults + causes + checks + params + keypad + status/cmd
  word + live decode, all cited. It is the gold reference.
- **PF40 / PF525 are fault+parameter reference packs only** — **no keypad, no status/command word, no
  registers, no live decode, no causes/checks** (all empty by honest omission — no bench data). They
  answer "what does F*NN* mean" and "what is P*NN*" with a manual citation, and nothing deeper.
- **Mnemonic-only drives (crane VFDs like Magnetek) are NOT yet a runtime capability** despite the
  schema, tests, and a complete staged candidate — the answer path can't reach `fault_entries`.
- **Everything answerable today is deterministic and $0.** The model is only used to read a photo.
