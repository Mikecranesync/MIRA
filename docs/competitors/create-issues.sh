#!/usr/bin/env bash
# Idempotent-ish batch-create Factory AI parity issues on Mikecranesync/MIRA.
# Bodies live next to this script in ./issue-bodies/. Run once; reruns create dupes.
set -euo pipefail

REPO="Mikecranesync/MIRA"
MS="Factory AI Parity"
BASE="factory-ai-parity,enhancement"

# Pre-flight: ensure milestone + label exist (no-op if they do).
# Errors here are informational; we don't want them to abort the run.
gh label create "factory-ai-parity" --repo "$REPO" --color "FF6F00" --description "Factory AI feature parity" 2>/dev/null || true
gh api -X POST "repos/$REPO/milestones" -f title="$MS" -f state="open" >/dev/null 2>&1 || true

DIR="$(dirname "$0")/issue-bodies"

new() {
  local title="$1" body="$2" extra="${3:-}"
  local labels="$BASE"
  [ -n "$extra" ] && labels="$labels,$extra"
  gh issue create --repo "$REPO" --milestone "$MS" --label "$labels" \
    --title "$title" --body-file "$DIR/$body" | tee -a /tmp/factoryai-issues.log
}

: > /tmp/factoryai-issues.log

new "[EPIC] Factory AI (f7i.ai) feature parity + leapfrog" 00-epic.md "P1"
new "hub(assets): full site → area → asset → component hierarchy with unlimited depth" 01-assets-hierarchy.md "P1"
new "hub(assets): auto-generate QR code per asset + mobile scan landing" 02-assets-qr.md ""
new "hub(assets): component template catalog (Motor/Pump/PLC/Gearbox/Compressor)" 03-component-templates.md "P2"
new "hub(workorders): full 7-state lifecycle + task/part/note/media sub-resources" 04-workorders-lifecycle.md "P1"
new "hub(workorders): PM procedures with safety-first schema + auto-spawn work orders" 05-pm-procedures.md "P1,safety"
new "hub(cmms): maintenance-strategies data model (7 types, MTBF, availability, cost/month)" 06-maint-strategies.md "P2"
new "hub(cmms): ISO 14224-aligned failure code taxonomy + library" 07-failure-codes-iso14224.md "P1"
new "hub(alerts): FFT + vibration peak detection endpoint (scipy.fft + bearing formulas)" 08-fft.md "P2"
new "hub(integrations): external-events ingest API (SCADA/ERP/MES/weather)" 09-external-events.md ""
new "hub(alerts): sensor reports + per-asset charts (GET endpoints)" 10-sensor-reports.md "P2"
new "hub(parts): inventory module — ABC/XYZ analysis, reorder logic, multi-vendor" 11-inventory.md "P2"
new "hub(parts): purchasing module — POs with dollar-threshold approvals" 12-purchasing.md "P2"
new "hub(assets): asset-scoped chat — GSDEngine streaming + BYO-LLM" 13-asset-chat.md "P0"
new "hub: mobile PWA — offline work orders + scan + photo capture" 14-mobile-pwa.md "P1"
new "hub(integrations): outbound webhooks — Slack/Teams/PagerDuty/Jira (they don't have this)" 15-webhooks.md "P0"
new "docs(api): public API reference site mirroring Factory AI's structure" 16-api-docs-site.md "P1,documentation"
new "hub: subdomain multi-tenancy routing (*.factorylm.com)" 17-subdomain-tenancy.md "P1,tenant-isolation"
new "hub: SSO via SAML + OIDC (neither they nor we have it — ship first)" 18-sso.md "P1,security"
new "ops: SOC 2 Type 1 kickoff (Vanta or Drata)" 19-soc2.md "P2,security"
new "leapfrog: open-source mira-safety-guard on PyPI" 20-mira-safety-guard.md "P2,safety"

echo "---"
echo "All done. URLs:"
grep -o "https://github.com/$REPO/issues/[0-9]*" /tmp/factoryai-issues.log
