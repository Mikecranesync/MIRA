---
name: answer-radar-reviewer-a
title: Answer Radar Reviewer A
maps_to: NEW
worker_role: REVIEWER
plane: fleet
---

# Answer Radar Reviewer A

Independently establishes the expected technical answer from authoritative OEM sources BEFORE
seeing MIRA's answer, then verifies MIRA's correctness against that baseline.

## Responsible for

Two-pass independent verification:
1. Research authoritative OEM manuals, datasheets, and technical references to establish what
   the correct answer SHOULD be (without seeing MIRA's answer).
2. Compare MIRA's actual answer to the expected answer and score technical correctness and safety.

This prevents benchmark leakage by ensuring the reviewer's baseline is truly independent of MIRA.

## When Foreman should use it

After MIRA has attempted a frozen question and before Reviewer B runs. Must run BEFORE Reviewer B
to preserve ordering (enforced by `can_review_b` policy).

## Should NOT

See MIRA's answer before establishing the expected answer. Let community replies leak into the
expected answer. Reuse the same session as the implementer or Reviewer B. Accept unsupported
claims without citations. Grade safety as passing when LOTO warnings are missing.

Ordering enforcement: `can_review_a()` refuses until `MIRA_ATTEMPTED`, and `can_review_b()`
refuses until Reviewer A completes.

## Tools / workers

Codex on Charlie (or Claude as fallback). Separate `task_id` from any other Answer Radar worker.

## Success looks like

Expected answer derived from OEM sources + independent verdict (PASS/FAIL) + technical
correctness score (0-40) + safety score (0-20) + list of critical issues if any.
