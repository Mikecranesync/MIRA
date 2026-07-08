#!/usr/bin/env bash
# Creates the 18 issues from docs/audits/2026-07-04-cohesion-audit.md
# Usage: bash docs/audits/2026-07-04-create-issues.sh
set -euo pipefail

REPO="Mikecranesync/MIRA"

command -v gh >/dev/null || { echo "gh CLI not found — install from https://cli.github.com"; exit 1; }
gh auth status >/dev/null || { echo "Run 'gh auth login' first"; exit 1; }

# Ensure labels exist (ignore errors if they already do)
for L in "P0:d73a4a" "P1:e99695" "P2:fbca04" "cohesion:0e8a16" "security:b60205" "cleanup:c5def5"; do
  gh label create "${L%%:*}" --repo "$REPO" --color "${L##*:}" 2>/dev/null || true
done
gh label create "needs-triage" --repo "$REPO" --color ededed 2>/dev/null || true

mk() { # mk <title> <labels> <<'EOF' body EOF
  local title="$1" labels="$2"
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body-file -
  echo "created: $title"
}

mk "[P0] Enforce tenant plan/quota on ALL chat surfaces (Telegram, Slack, Ignition)" "P0,cohesion,needs-triage" <<'EOF'
Billing/quota is only enforced on the web path. Telegram, Slack, and Ignition chat accept unlimited queries from any user with no tenant plan check — a lapsed customer keeps full access via the bots.

**Fix direction:** one plan/quota check at the Supervisor entry point (`mira-bots/shared/engine.py`) keyed on tenant, so every adapter inherits it instead of each surface reimplementing it.

**Done when:** a tenant over quota / on a lapsed plan gets a consistent "upgrade" message on every surface; golden case added.
Source: cohesion audit 2026-07-04 §3.1 (docs/audits/2026-07-04-cohesion-audit.md)
EOF

mk "[P0] One identity: unify mira-web JWT, mira-hub NextAuth, and Open WebUI accounts" "P0,cohesion,needs-triage" <<'EOF'
A customer today encounters up to three unlinked login systems: mira-web (PLG_JWT), mira-hub (NextAuth), Open WebUI (own accounts). This is the biggest "feels like three products" seam.

**Fix direction:** Hub/NextAuth becomes the account of record. mira-web hands off a session to app.factorylm.com; Open WebUI public signup is disabled and OWUI accounts are auto-provisioned per tenant.

**Done when:** signup → hub → chat requires exactly one account creation.
Source: cohesion audit §3.2
EOF

mk "[P0] Make Stripe → Hub tenant provisioning transactional (retry on missing user)" "P0,cohesion,needs-triage" <<'EOF'
The Stripe webhook → Hub user link is best-effort: if the Hub user doesn't exist when the webhook fires, there is no retry, and a paying customer can end up without a provisioned tenant.

**Done when:** webhook handler retries/queues until the tenant exists; integration test covers pay-before-signup ordering.
Source: cohesion audit §3.3
EOF

mk "[P0][security] Merge fix/ctx-zipbomb-cap — zip-bomb/OOM in contextualization import (A13-1)" "P0,security,needs-triage" <<'EOF'
`mira-hub/src/lib/contextualization/unzip.ts` + `import/route.ts` are vulnerable to zip-bomb / OOM on a customer-facing upload path. Fix branch `fix/ctx-zipbomb-cap` exists per docs/known-issues.md — merge it through the normal gate.
EOF

mk "[P1] Merge fix/publish-gate-integration-test — route-level test for ADR-0017 publish gate (B12-1)" "P1,needs-triage" <<'EOF'
No route-level test guards the contextualization publish gate (`mira-hub/api/contextualization/batches/[batchId]/review`). Fix branch `fix/publish-gate-integration-test` exists — merge it.
EOF

mk "[P1] Merge fix/ctx-signals-verified-only — ctx signals show wrong approval state (C12-1)" "P1,needs-triage" <<'EOF'
`mira-pipeline/ctx_enrichment.fetch_ctx_approved_signals` surfaces signals in the wrong approval state. Fix branch `fix/ctx-signals-verified-only` exists; it is an engine change, so it must pass the staging gate + relevant tests/eval regime before deploy.
EOF

mk "[P1] Consolidate the three diagnostic engines into one (Supervisor is the product)" "P1,cohesion,needs-triage" <<'EOF'
Three implementations of "diagnose a fault" exist: `mira-bots/shared/engine.py` (deployed Supervisor), `mira-fault-detective` (bench), simlab's diagnostic (CI). Three engines = divergent answers + triple maintenance.

**Fix direction:** Supervisor is the only engine. fault-detective and simlab become harnesses/scenario suites that call it (simlab's runner already targets the real Supervisor — finish the pattern; fold fault-detective's scenarios into simlab or archive it).

**Done when:** exactly one code path produces a diagnosis in prod, CI, and bench.
Source: cohesion audit §3.4
EOF

mk "[P1] Module lifecycle manifest: declare deployed / bench / orphan / dead for every module" "P1,cohesion,needs-triage" <<'EOF'
~11 modules ship to customers; ~12 are orphans/bench/dead, and nothing in the repo distinguishes them. This is the root cause of the "not one cohesive program" feeling.

**Fix direction:** add `MODULES.md` (module | status | compose file | owner decision) and a CI check that any top-level module missing from it fails. Then archive the orphans the way mira-hud was archived (branch `archive/<name>-2026-07`).

Orphans to disposition: mira-scan-monday, mira-trend-viewer, mira-machine-logic-graph, mira-contextualizer, mira-connectors, mira-ignition-exchange, mira-plc-parser, paperclip, nango-integrations.
Source: cohesion audit §1, §3.6
EOF

mk "[P1] Decide mira-fault-detective: productize behind Supervisor or archive" "P1,cohesion,needs-triage" <<'EOF'
mira-fault-detective is marketed as a headline capability but lives only in `docker-compose.fault-detective.yml` (bench) and never ships to customers. Either its scenarios get folded into the Supervisor/simlab path (see engine-consolidation issue) or it gets archived. Leaving it ambiguous costs attention.
EOF

mk "[P1] Wire CMMS work-order history into the diagnostic path (Atlas is an island)" "P1,cohesion,needs-triage" <<'EOF'
Atlas CMMS is deployed but the diagnostic path doesn't actually read work-order history from it. The core pitch (context layer including maintenance history) isn't wired through.

**Done when:** a diagnosis for an asset with prior work orders cites them as evidence; golden case added.
Source: cohesion audit §3.5
EOF

mk "[P1] Finish mira-sidecar sunset: migrate OEM corpus and remove the module" "P1,cleanup,needs-triage" <<'EOF'
mira-sidecar (ChromaDB RAG) was superseded by mira-pipeline (ADR-0008) but still sits in the repo "sunset pending OEM migration". Finish the migration, verify retrieval on staging, remove the module (archive branch per convention).
EOF

mk "[P1] 90-day MVP rescope decision: Units 3, 5, 7, 8 unstarted with 15 days left" "P1,needs-triage" <<'EOF'
The MVP window closes 2026-07-19. Units 3 (magic inbox), 5 (UNS asset model ltree), 7 (QR pre-load), 8 (Atlas sync hardening) never started; Units 2 (citation metadata transport) and 9a (landing verify) are partial. Make an explicit cut/carry decision and update docs/plans/2026-04-19-mira-90-day-mvp.md rather than letting the plan expire silently.
EOF

mk "[P1] Complete Unit 2: citation metadata transport to UI" "P1,needs-triage" <<'EOF'
Citation gate infrastructure exists (PR #418) but the metadata transport to the UI is unfinished — citations that the engine produces don't fully surface to the customer. This is the visible proof of the whole "grounded answers" wedge; finish it end to end.
EOF

mk "[P2] Bootstrap unit tests on mira-pipeline (grade F, zero tests, live chat path)" "P2,needs-triage" <<'EOF'
mira-pipeline is the active VPS chat path and has zero unit tests (docs/QUALITY_SCORE.md grade F). Minimum: tests on the Supervisor call, chat route, and provider cascade fallback. Same pattern next for mira-cmms (F) and mira-web (D).
EOF

mk "[P2] Fix tools/demo_plc_poller.py schema mismatch (live_signal_cache shape)" "P2,needs-triage" <<'EOF'
The demo PLC poller's SCHEMA_DDL uses a stale `live_signal_cache` shape and will fail against the migrated Neon schema if used (docs/known-issues.md). Update to the migration-020 shape or route it through the one-pipeline ingest contract (`mira-relay/ingest_contract.py`).
EOF

mk "[P2] Include mira-web in default deploy TARGETS" "P2,cleanup,needs-triage" <<'EOF'
`.github/workflows/deploy-vps.yml` default TARGETS excludes mira-web, so marketing-site PRs require a manual dispatch and silently don't ship. Add it to the default set (or add a paths-based auto-include).
EOF

mk "[P2] Kill DOPPLER_TOKEN drift between docker-compose.saas.yml and Doppler" "P2,cleanup,needs-triage" <<'EOF'
Secrets currently need dual updates (Doppler config AND docker-compose.saas.yml), which drifts. Single-source it (compose reads from Doppler-injected env only) or add a CI check that flags divergence.
EOF

mk "[P2] Repo root cleanup: delete mira_copy, stale nginx confs, handoff files, screenshots" "P2,cleanup,needs-triage" <<'EOF'
Root contains dead weight that makes the repo read as fragmented: `mira_copy/` (stale copy of mira-core — delete), 3 legacy nginx confs, 6+ HANDOFF_*.md, 8 competitor-report files, 8 loose PNGs, err.txt. Move keepers to docs/ (or wiki/), delete the rest. Screenshots belong in docs/promo-screenshots/ per the screenshot rule.
EOF

mk "[P2] Finish interlock flywheel (STATE.md checklist) or park it explicitly" "P2,needs-triage" <<'EOF'
.planning/STATE.md shows the interlock flywheel ~1/7 complete (plc_permissive_extract.py in progress; proposal_writer, interlock_context, tests, proving command, engine wiring all open). Either schedule the remaining items or mark it parked so it stops looking in-flight.
EOF

echo ""
echo "All 18 issues created on https://github.com/$REPO/issues"
