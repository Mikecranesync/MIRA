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
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
DIR=$(mktemp -d); GAPS="$DIR.gaps"; LESS="$DIR.receiptless"; : > "$GAPS"; : > "$LESS"
# Same walk as deploy-vps.yml and rollback-candidate-refresh.yml: only main-branch dispatches (a run
# dispatched from another ref executes ITS copy of the workflow and could upload a receipt of its own
# making), any conclusion. Pass 1 reads every readable receipt; an unreadable one is a gap bounded by
# its run's updatedAt. Pass 2 asks whether a receipt-less run that could post-date them had uploaded one.
gh run list --workflow deploy-vps.yml --branch main --event workflow_dispatch --status completed --limit 200 \
  --json databaseId,updatedAt --jq '.[] | "\(.databaseId) \(.updatedAt)"' > "$DIR.runs"
while read -r run updated; do
  art=$(gh api "/repos/$REPO/actions/runs/$run/artifacts" \
    --jq '[.artifacts[] | select(.name|startswith("production-receipt-"))] | if length > 1 then error("more than one production receipt in run") elif length == 0 then empty else "\(.[0].id) \(.[0].expired)" end') || break
  if [ -z "$art" ]; then printf '%s\t%s\n' "$run" "$updated" >> "$LESS"; continue; fi
  read -r id expired <<< "$art"
  if [ "$expired" != "false" ]; then printf '%s\t%s\treceipt expired\n' "$run" "$updated" >> "$GAPS"; continue; fi
  mkdir -p "$DIR/$run" && gh api "/repos/$REPO/actions/artifacts/$id/zip" > "$DIR/$run.zip" \
    && unzip -o -q "$DIR/$run.zip" -d "$DIR/$run" && rm "$DIR/$run.zip"
done < "$DIR.runs"
since=$(python3 tools/rollback_candidates.py since --receipts-dir "$DIR")
while IFS=$'\t' read -r run updated; do
  [ -n "$since" ] && [[ ! "$updated" < "$since" ]] || continue
  up=$(gh api "/repos/$REPO/actions/runs/$run/jobs?per_page=100" \
    --jq '[.jobs[].steps[]? | select(.name == "Upload production receipt (90-day retention)" and .conclusion == "success")] | length')
  [ "$up" = "0" ] || printf '%s\t%s\treceipt gone after a successful upload\n' "$run" "$updated" >> "$GAPS"
done < "$LESS"
python3 tools/rollback_candidates.py designate --receipts-dir "$DIR" \
  --inventory "mira-hub mira-web mira-ask" --gaps "$GAPS"   # what production designates now
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

Expand/contract: code rolled back across a **contracting** migration (a dropped/renamed column or
table, a column type change, `SET NOT NULL`) breaks. Check every migration directory an `apply-*`
workflow applies:

```bash
git fetch origin main
python3 tools/rollback_candidates.py compat --candidate <sha> --head "$(git rev-parse origin/main)" --repo .
# exit 0 = no contracting statement since the candidate; 1 = list printed, needs a schema decision (§5)
```

This is conservative: it reads migration files added on `main` after the candidate, whether or not
`apply-migrations.yml` has applied them to production yet, and it counts every `DROP` of a table, view,
type, sequence, schema or function even when the same file re-creates the name (the new object may not
be what older code expects). Literals and comments are ignored, and DDL inside `DO` blocks and function
bodies is checked. On 2026-10-04 the whole corpus had five contracting files (`048`, `069`, `070`:
`tenant_id` → `TEXT`; `033`: a guarded column rename; `063`: a drop-and-recreate of
`flaky_input_signals`) and none since `0994b31a`.

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
