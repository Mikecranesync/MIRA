# Rollback runbook (production)

**Status:** R3 governance document (SDLC v1 §2.1). Rule: `docs/architecture/mira-sdlc-v1.md` §10.2.
Implements Part B step 10. Replaces `docs/runbooks/hubv3-rollback.md` as the general procedure; that
file stays as the record of the 2026-06-20 HubV3 release and its `-f ref=` mechanics no longer exist.

**One sentence:** a rollback is a **forward deploy of a known-good SHA** through the same gates —
`deploy-vps.yml` with `approved_rc_sha=<candidate>` — plus a separate data decision. Nothing about a
rollback bypasses the staging receipt, the generation-bound acceptance receipt, the migration-drift
gate, or the human dispatch.

---

## 1. The recovery candidate (what you roll back to)

Every production deploy records, **per deployed service**, a `rollback_candidate` on its
`production-receipt-<sha>` artifact (90-day retention):

```json
"rollback_candidate": {
  "mira-hub": {"sha": "<40-hex>", "from_run_id": "<deploy-vps run>", "reason": "previous production SHA of mira-hub: …"},
  "mira-web": {"sha": null, "from_run_id": null, "reason": "no earlier production receipt deployed mira-web within artifact retention"}
}
```

- It is the newest **receipted** production SHA of that service other than the one being deployed,
  computed by `deploy-vps.yml` `authorize-source` (step *Record rollback candidates*) from the earlier
  production receipts, before anything touches the host. It is never `PRIOR_SHA` (the host checkout,
  which is not the per-service runtime set: a `services=mira-ask` deploy leaves Hub and Web where
  they were) and never a tag.
- Services are independent. On 2026-10-01 production ran Hub + Ask at `648896996` but Web at
  `76887423` (the 10-01 deploy did not include Web), so a later deploy records Hub→`648896996`,
  Ask→`648896996`, Web→`76887423`.
- **A deploy that fails before its production verify uploads no receipt.** The candidate is therefore
  the last *receipted* SHA — which is what you want: an unreceipted generation was never proven. A run
  whose receipt was uploaded counts whatever its final conclusion: only the read-only nginx check runs
  after the upload, so production really is on that SHA.
- `sha: null` is explicit, never absent: no earlier receipt within retention means no automatic
  candidate for that service, and a human picks one (§4).

**Find the current candidates** (read-only; needs `gh` and the repo):

```bash
( # a subshell: any failed call aborts here, before a designation is printed
set -euo pipefail
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
CAP=1000
DIR=$(mktemp -d); GAPS="$DIR.gaps"; LESS="$DIR.receiptless"; : > "$GAPS"; : > "$LESS"
# Same walk as deploy-vps.yml and rollback-candidate-refresh.yml: only main-branch dispatches (a run
# dispatched from another ref executes ITS copy of the workflow and could upload a receipt of its own
# making), any conclusion, created in the last 121 days. Pass 1 reads every readable receipt; an
# unreadable one is a gap bounded by its run's updatedAt. Pass 2 asks whether a receipt-less run that
# could post-date them ran its Deploy step (the swap precedes the receipt).
gh run list --workflow deploy-vps.yml --branch main --event workflow_dispatch --status completed \
  --created ">=$(python3 tools/rollback_candidates.py window-start --days 121)" --limit "$CAP" \
  --json databaseId,updatedAt --jq '.[] | "\(.databaseId) \(.updatedAt)"' > "$DIR.runs"
if [ "$(grep -c . "$DIR.runs" || true)" -ge "$CAP" ]; then   # truncated: older runs unread
  printf '%s\t%s\trun listing truncated\n' "$(tail -n 1 "$DIR.runs" | cut -d' ' -f1)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GAPS"
fi
while read -r run updated; do
  art=$(gh api "/repos/$REPO/actions/runs/$run/artifacts" \
    --jq '[.artifacts[] | select(.name|startswith("production-receipt-"))] | if length > 1 then error("more than one production receipt in run") elif length == 0 then empty else "\(.[0].id) \(.[0].expired)" end')
  if [ -z "$art" ]; then printf '%s\t%s\n' "$run" "$updated" >> "$LESS"; continue; fi
  read -r id expired <<< "$art"
  if [ "$expired" != "false" ]; then printf '%s\t%s\treceipt expired\n' "$run" "$updated" >> "$GAPS"; continue; fi
  mkdir -p "$DIR/$run"
  gh api "/repos/$REPO/actions/artifacts/$id/zip" > "$DIR/$run.zip"
  unzip -o -q "$DIR/$run.zip" -d "$DIR/$run"
  rm "$DIR/$run.zip"
done < "$DIR.runs"
since=$(python3 tools/rollback_candidates.py since --receipts-dir "$DIR")
while IFS=$'\t' read -r run updated; do
  [ -n "$since" ] && [[ ! "$updated" < "$since" ]] || continue
  ran=$(gh api --paginate "/repos/$REPO/actions/runs/$run/jobs?per_page=100&filter=all" \
    --jq '[.jobs[].steps[]? | select(.name == "Deploy" and .conclusion != null and .conclusion != "skipped")] | length' \
    | awk '{ n += $1 } END { print n + 0 }')
  [ "$ran" = "0" ] || printf '%s\t%s\tproduction may have changed without a receipt\n' "$run" "$updated" >> "$GAPS"
done < "$LESS"
python3 tools/rollback_candidates.py designate --receipts-dir "$DIR" \
  --inventory "mira-hub mira-web mira-ask" --gaps "$GAPS"   # what production designates now
)
```

`designate` prints `current` (what each service runs), `designated` (targets, grouped by SHA),
`undesignated` (services whose current receipt predates the field or records `sha: null`) and `lost`
(a default-set service with no readable receipt — GitHub omits expired artifacts and removes old
runs, so absence is missing history, never "never deployed" — or any service whose current receipt an
unreadable run could post-date; the daily check opens an `incident` for each). Accepted limitation: a service outside the
default set whose only receipts are past the 90-day retention cannot be seen at all, because no
durable service inventory outlives the receipts. For a
service whose current receipt predates the field, the same walk the deploy uses gives its previous
production SHA:

```bash
python3 tools/rollback_candidates.py candidates --receipts-dir "$DIR" \
  --deploying <sha-currently-running-for-that-service> --services "mira-hub mira-web mira-ask"
```

## 2. Is the candidate still a valid code-only target?

Expand/contract: code rolled back across a migration that older code cannot live with breaks. The
check **fails closed**: a candidate is valid only if every statement in every migration file added on
`main` after it, in every directory an `apply-*` workflow applies, is on the expand-only allowlist
below. Anything else, a known contraction or merely something the tool cannot prove harmless, needs
a human decision.

```bash
git fetch origin main
python3 tools/rollback_candidates.py compat --candidate <sha> --head "$(git rev-parse origin/main)" --repo .
# exit 0 = every later statement is expand-only; 1 = CONTRACTING / UNPROVEN lines printed (§5)
```

| Allowed (expand-only) | Why older code can neither read nor write wrongly through it |
|---|---|
| `BEGIN`, `COMMIT`, `END`, `START TRANSACTION` | transaction control, no schema change |
| `SET [LOCAL\|SESSION] name TO\|= value` | this migration's session only |
| `CREATE TABLE …` without `INHERITS` / `PARTITION OF` (and no later `INHERIT` / `ATTACH PARTITION` of an older table), foreign keys only to tables new in the file | a new table older code never references; an FK into an older table could block its deletes |
| `CREATE SEQUENCE …` | a new object older code never references |
| `COMMENT ON …` | metadata only |
| `GRANT …` | can only allow more |
| `ALTER TABLE … ADD COLUMN c <built-in type>` with only `NULL`, `COLLATE`, a default that is a constant, `now()` or `gen_random_uuid()`, and `NOT NULL` only together with such a default | older inserts omit `c`, so `c` must take NULL or a default that always succeeds; a domain type, a constraint or any other default expression could reject older rows |
| any statement on a table a **plain** `CREATE TABLE` made earlier in the same file | older code cannot touch a table that did not exist (`IF NOT EXISTS` proves nothing) |

Not on it, on purpose: `CREATE INDEX` on an existing table (an expression or predicate can error,
and a btree rejects rows over its size limit), data changes to existing tables, `CREATE UNIQUE INDEX`, `DROP INDEX` and
`DROP CONSTRAINT` (one may be the `ON CONFLICT` arbiter of an older upsert), `ADD CONSTRAINT`, policies
and RLS, `REVOKE`, triggers, `CREATE [OR REPLACE] FUNCTION/VIEW` (behaviour and overload resolution),
`CREATE EXTENSION`, `DO` blocks, and anything unrecognised. A known contraction (a dropped or renamed
column or table, a type change, `SET NOT NULL`, any dropped object, including inside `DO` blocks and
`EXECUTE` strings) is labelled `CONTRACTING`; the rest is `UNPROVEN`. Both make the candidate invalid.

This reads files added on `main` after the candidate whether or not `apply-migrations.yml` has applied
them yet. **Measured on 2026-10-04:** 108 of the 123 existing migration files are not provably
expand-only (most use `DO` blocks, functions, triggers, RLS or indexes on existing tables), and all three real candidates
(`648896996`, `76887423`, `0994b31a`) are already invalid because of `101`, `102` and `104`
(trigger and function changes). Expect the daily check to raise an incident whenever production's
candidate predates such a migration; a human decides, and it clears once a deploy moves the
candidate past it. A durable, off-file record of reviewed migrations would remove the repeats; it is
tracked in #4225, not part of this check (applied migration files are immutable, so it cannot be a
marker inside them).

## 3. Is its evidence fresh?

A rollback dispatch is authorized exactly like any deploy: an unexpired `staging-receipt-<sha>` from a
successful `deploy-staging.yml` dispatch and a generation-bound `acceptance-receipt-<sha>` from the
`retrieval-acceptance.yml` run that deploy triggered, both ≤168 h old (§6.2).

`rollback-candidate-refresh.yml` checks this **daily (07:41 UTC)** for every designated candidate,
verifying with the same trusted validators and flags `authorize-source` uses:

| Outcome | Meaning | What it does |
|---|---|---|
| `FRESH` | verifies, more than 72 h of validity left | summary only |
| `DUE` | verifies, expires within 72 h | opens `Rollback candidate <sha12> refresh due` (not an incident) with the re-stage command |
| `STALE` | evidence missing, expired or not verifying | opens/updates an **`incident`** issue `Rollback candidate <sha12> lost recovery readiness` with the §10.3 fields; the run fails |
| `INVALID` | a contracting migration landed after it | same incident; the run fails |
| no candidate | no production receipt records `rollback_candidate` yet | notice only |

Run it on demand: `gh workflow run rollback-candidate-refresh.yml`.

**Re-staging is not automated yet.** A `deploy-staging.yml` run dispatched with a workflow's own
`GITHUB_TOKEN` does not fire `workflow_run`, so `retrieval-acceptance.yml` would not run, and
`authorize-source` accepts only `workflow_run`-produced acceptance receipts. Closing that needs an
owner decision: a scoped dispatch credential, or a change to the step-4/5 provenance model. Until
then a human re-stages when the workflow asks:

```bash
gh workflow run deploy-staging.yml -f approved_rc_sha=<candidate> -f reset_volumes=false
# then wait for deploy-staging (success) and the retrieval-acceptance run it triggers (PASS)
```

`reset_volumes=false` always: `true` wipes the staging database. Re-staging **replaces whatever
staging is running** — staging is one slot — so check that nobody is mid-validation of another RC
first. Re-staging a SHA another RC's evidence depends on is not destructive (receipts are per SHA and
stored as artifacts), but re-staging the *same* SHA starts a new generation, and the next
`authorize-source` binds to that new generation's acceptance run.

## 4. Execute the rollback

Preconditions: §2 clean (or §5 decided), §3 fresh. The dispatch is a production deploy — **human
authorized** (§7.3), never by an agent on its own.

```bash
gh workflow run deploy-vps.yml -f approved_rc_sha=<candidate> -f services="<the services being rolled back>"
```

- `services` = exactly the services you are rolling back (the smallest safe set). The staging receipt
  must prove every one of them; `authorize-source` checks.
- Candidate *selection* never uses tags, but the dispatch still needs the `v*` release tag that
  `deploy-vps.yml` resolves for the SHA. Every previously deployed SHA has one: production deploys
  only tagged merge commits on `main`.
- The new production receipt records its own `rollback_candidate` (normally the bad SHA you just
  left) — the walk is symmetric.

After it completes (G4, §9): dispatch `smoke-test.yml`, confirm `/api/version` (Hub) and
`/api/health` (Web) report the candidate's `gitSha`, and fill the incident's `restored_at` and
`restoring_action: deploy`.

## 5. Database

`apply-migrations.yml` has no down mode. Code rollback inside the expand/contract window never needs
a schema rollback. If §2 reports a contraction, rolling the code back needs a data decision first: R3
migration PRs record the Neon snapshot/branch id and the rollback SQL at G0 (CP-before). Never `psql`
production from a session (`prod-guard.sh`).

## 6. Mobile / OTA

`mira-mobile/scripts/ota-rollback.mjs` and `ota-release.yml promote` re-point the signed manifest; the
handset-evidence job applies to a rollback too.

## 7. Drill (required before v1 is declared adopted)

Deploy the designated candidate to staging, run acceptance, exercise `deploy-vps.yml`
`authorize-source` against it with the smallest safe `services`, and walk A→B→rollback-to-A with B
current more than 168 h. A receipt-only staging drill does not count. The drill uses production
dispatches, so it runs only on Mike's explicit go.

| Date | A (candidate) | B | Dispatch run ids | Result |
|---|---|---|---|---|
| — | — | — | not yet run (needs production dispatches; owner decision) | — |

## 8. Evidence log

| Date | What | Run / artifact | Result |
|---|---|---|---|
| 2026-10-04 | Candidates computed locally (read-only) from the three real production receipts, runs 36350115024, 36369296665, 36805202089 | — | Hub/Ask → `648896996`, Web → `76887423`; `designate` → no candidate (no receipt records the field yet) |
