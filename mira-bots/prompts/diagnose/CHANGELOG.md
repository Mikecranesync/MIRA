# Prompt CHANGELOG — diagnose/

## [0.1] — 2026-03-18 (baseline, LOCKED)

**Codename:** baseline
**Model:** claude-3-5-haiku-20241022
**Status:** Locked — do not edit v0.1-baseline.yaml

### What it does
- GSD (Guided Socratic Dialogue) method — never answers directly
- Photo transcription: copies all visible text exactly before asking questions
- FSM integration: returns JSON with next_state, reply, options
- Safety override: STOP message for visible hazards
- 50-word max per message (except photo analysis)
- One question at a time, 3-4 numbered options

### Known limitations
- Responses occasionally exceed word limit in complex diagnostic branches
- No structured diagnostic ladder beyond Q1→Q2→Q3 FSM states
- Manual/part requests not auto-redirected to knowledge base
- Options can be invented when screen content is unclear

### Baseline scores (golden_dataset/v0.1.json)
| Metric | Score |
|--------|-------|
| Contains question | TBD |
| Response ≤50 words | TBD |
| No invented facts | TBD |
| Safety triggered correctly | TBD |
| GSD compliance | TBD |

*(Scores to be filled after Phase 2 acceptance test runs)*
