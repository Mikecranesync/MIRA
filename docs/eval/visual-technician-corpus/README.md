# MIRA Visual Technician — real-photo benchmark corpus

Real technician photos + ground-truth labels + pass/fail criteria, per the PRD's
benchmark-corpus deliverable. Each `hard_failures/*.yaml` is a case where a naive
answer fabricates; a passing MIRA answer must be **grounded or honestly refuse** —
never invent a device/terminal/rating that isn't visible.

Images live in `images/` (referenced by the manifests). Manifests carry the source
metadata, the question, the observed (often wrong) response, the diagnosed root
cause, and machine-checkable `pass_criteria` / `hard_fail_if_any`.

## Cases
- `hard_failures/mack_intrasys_brake_stator.yaml` — Mack/InTraSys LSM final-brake
  stator sheet (Universal "Racing Coaster", drawing 2400WK0266). The prod bot called
  it "ladder logic" and invented timers/counters/logic-gates. **Canonical
  "never invent a device list" regression.** Root cause: a device question bypassed
  the grounded `print_translator` path and hit the generic engine; the vision model
  itself reads the print correctly when prompted to ground.
