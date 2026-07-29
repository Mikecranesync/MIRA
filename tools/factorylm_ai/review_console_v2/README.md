# Review Console v2 (canonical source)

The live sitting server that runs on the PLC laptop at
`C:\Users\hharp\Documents\mira-review-v2\` (port 8377, fronted by Tailscale
serve/funnel on 8443). This directory is the **canonical source**; the runtime
is a manual copy. **Merging this directory does NOT deploy it** — deploying is
an explicit, human-ordered copy of `server.py` + `index.html` over the runtime
followed by a server restart (decisions survive: state lives in
`data/events.jsonl`, which the server replays on boot).

- Zero dependencies (stdlib http.server). Auth = single access key (`?k=`),
  constant-time compare. Ledger = append-only `events.jsonl`, last-wins replay.
- Self-test (hermetic, temp-dir world, real HTTP): `py -3 server.py --selftest`
- Env overrides: `MIRA_REVIEW_V2_DIR`, `MIRA_REVIEW_V2_DATASET`,
  `MIRA_REVIEW_V2_MANIFEST`, `MIRA_REVIEW_V2_DOWNLOADS`,
  `MIRA_REVIEW_V2_RECOMMENDATIONS`.

## Review-by-exception (policy `review-by-exception.v1`)

Optional. Point `MIRA_REVIEW_V2_RECOMMENDATIONS` at a `recommendations.jsonl`
produced by `factorylm_ai/dataset/review_recommendations.py` (deterministic
checks + an independent reviewer — never the model being trained — both bound
to the frozen manifest/content hashes). Then:

- Cards marked `auto_approve_ok` show an **AUTO-OK** badge and a bulk
  "Approve N recommended low-risk cards…" action: `/api/bulk_preview` returns
  a summary + confirmation token bound to the *current* eligible set;
  `/api/bulk_commit` re-verifies every record server-side (safety-sensitive,
  correction, held-out, no-rights, already-decided → excluded regardless of
  the advice file) and appends ordinary approval events with
  `mode=bulk` + policy/evidence/confidence audit fields.
- A deterministic 10% of recommended cards (**QA** badge) are excluded from
  bulk and routed to individual human review; if human decisions on sampled
  cards disagree with the recommendation at a rate above 2%, bulk approval is
  disabled (409) until the humans win the argument.
- Missing/invalid recommendations file → the console behaves exactly as
  before (no bulk UI, everything individual).

The ledger stays append-only; exports stay importer-schema-compatible; the
access key is the same and no new data is exposed.
