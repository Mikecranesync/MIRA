# F2 settled empirically — the new turn-mode values need no migration

**Finding (Gate 7, sustained twice):** *"Database schema incompatibility for new
turn-mode values … the INSERT will be rejected, causing a 500 error and loss of
turn data. No migration is provided in this PR, and the unit tests use a mocked
DB, so the defect is invisible to the test suite."*

The reviewer was right to raise it and right that mocked tests cannot answer it.
It sustained the finding twice on the same ground — *"the database schema remains
unchecked"* — which a diff-only reviewer structurally cannot resolve, because the
evidence is an **unchanged** file: absence of a migration is the claim, not a gap
in it.

So it was settled by running it.

## Method

Ephemeral `postgres:16`, with the column DDL taken verbatim from
`mira-hub/db/migrations/090_decision_traces_turn_packet.sql`:

```sql
ALTER TABLE decision_traces
    ADD COLUMN IF NOT EXISTS evidence_packet   JSONB,
    ADD COLUMN IF NOT EXISTS anomalies         JSONB;
```

Then inserted a packet carrying each new value, exactly as
`persist-usage.ts` does (`JSON.stringify(record.packet)` into `evidence_packet`).

## Result

```
 t1 -> augmented / augmented
 t2 -> source_only / source_only

CHECK constraints on decision_traces: NONE
```

Both `request.mode` and `context.system_prompt_kind` round-tripped. **No migration
is required, and none should be written** — `evidence_packet` is JSONB and the mode
values are ordinary JSON strings inside it. There is no enum and no CHECK
constraint on these fields in any migration in the repository.

## Why the TypeScript unions still had to widen

The unions are a **compile-time** contract, not a database one. Leaving them narrow
is what broke the build (`route.ts:936`, caught by `npm run build`, not by vitest)
and took Hub E2E and the beta gate down with it. Widening them fixed the build;
the database never needed anything.

## Scope of this proof

This proves the storage layer accepts the values. It does not prove downstream
consumers interpret them — that was F3, and the one real consumer
(`tools/qa/retrieval_acceptance.py`) was fixed in `65738d699`. The only other
reader, `tools/qa/jev_shadow_report.py`, passes the value through without matching
on it.
