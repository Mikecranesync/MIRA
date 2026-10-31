<!-- SYNTHETIC FIXTURE NOTICE: fixtures/synthetic_sessions.jsonl is synthetic sample data
     (session ids prefixed SYN-). It is not replayed staging data and is not evidence of
     any measured recovery time. -->

# tools/mttr: failure-penalized median minutes (Pain 3)

`median_minutes.py` turns replayed notebook sessions into a recovery-time summary per arm.
Stdlib only, deterministic, no LLM.

## Input (JSONL, one session per line)

```json
{"session_id": "...", "fault_asked_at": "2026-10-31T09:00:00+00:00",
 "first_cited_step_at": "2026-10-31T09:03:10+00:00", "outcome": "resolved", "arm": "control"}
```

- `outcome`: `resolved` | `failed` | `abandoned`
- `first_cited_step_at`: ISO-8601 with timezone, or `null`
- `arm`: optional string; missing arm is grouped as `unlabeled`

## Definition

- A **completed** session has `outcome == "resolved"` and a non-null `first_cited_step_at`.
  Its time is `first_cited_step_at - fault_asked_at` in minutes.
- Every other session (failed, abandoned, or never reached a cited step) ranks at `+infinity`.
- **Median** is taken over all sessions in the group, so unsuccessful sessions count.
  Even n uses the mean of the two middle values. An infinite middle value makes the median infinite,
  reported as `inf`.
- **p25 / p75** use completed sessions only (linear interpolation).
- Every median is reported beside `n` and the completion rate. No means are reported.

## Run

```bash
python3 tools/mttr/median_minutes.py tools/mttr/fixtures/synthetic_sessions.jsonl
```

Prints a table and one JSON line. Exit 0 on success, 2 on invalid input.
Tests: `python3 -m pytest tools/mttr -q`.

## Fixture

`fixtures/synthetic_sessions.jsonl` is **SYNTHETIC**: 20 invented sessions (`SYN-*`) across two
arms, for exercising the tool only.

## Real input (not in this PR)

Real input is replayed staging sessions. Exporting them needs a read-only staging query and
Mike GO. See `goal/out/L2-mttr-metric.md` for the exact command to request.
