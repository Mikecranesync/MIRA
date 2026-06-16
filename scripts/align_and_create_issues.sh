#!/usr/bin/env bash
# Aligns Mikecranesync/MIRA to the FactoryLM × MIRA 90-day roadmap.
#
# What this does:
#   1) Creates net-new issues from the roadmap that don't yet exist
#   2) Adds labels + milestones to existing issues that need re-prioritization
#   3) Marks deferred issues with `defer-q3-2026`
#   4) Comments + closes duplicate eval issues (#525, #596, #597)
#   5) Closes #440 (qr-onboarding skill — already shipped)
#
# Run order:
#   gh auth status   # verify
#   bash scripts/align_and_create_issues.sh
#
# Companion docs:
#   docs/website-refactor-roadmap-2026-04-26.md
#   docs/design-system-2026-04-26.md
#   docs/design-handoff-2026-04-26.md
#   docs/gh-alignment-2026-04-26.md  ← read this first

set -euo pipefail
REPO="Mikecranesync/MIRA"
MILESTONE_P0="Phase 0 — Foundation"

# --- Ensure labels exist ---
declare -a LABELS=(
  "design-system:A78BFA"
  "seo:10B981"
  "geo:06B6D4"
  "hub:F59E0B"
  "defer-q3-2026:94A3B8"
  "marketing-content:00897B"
  "factorylm-mira:1B365D"
)
for entry in "${LABELS[@]}"; do
  name="${entry%%:*}"; color="${entry##*:}"
  gh label create "$name" --color "$color" --repo "$REPO" 2>/dev/null || true
done

# --- Ensure milestone exists ---
gh api "repos/$REPO/milestones" -f title="$MILESTONE_P0" \
  -f description="W1 — stabilize Hub, ship landing fixes, lay SEO+GEO foundation, restore eval pipeline." \
  -f due_on="2026-05-03T23:59:59Z" 2>/dev/null || true

# --- create_issue: idempotent — checks by exact title match ---
create_issue() {
  local title="$1"; local body="$2"; local labels="$3"; local milestone="$4"
  local existing
  existing=$(gh issue list --repo "$REPO" --state open --search "\"$title\" in:title" --json number --jq ".[0].number" 2>/dev/null || echo "")
  if [ -n "$existing" ]; then
    echo "SKIP — exists as #$existing: $title"
    return
  fi
  echo "CREATE — $title"
  if [ -n "$milestone" ]; then
    gh issue create --repo "$REPO" --title "$title" --body "$body" \
      --label "$labels" --milestone "$milestone"
  else
    gh issue create --repo "$REPO" --title "$title" --body "$body" \
      --label "$labels"
  fi
}

# --- Net-new issues (Wave A + B foundation — design system) ---

create_issue \
  "feat(web): canonical design tokens — public/_tokens.css" \
  "Roadmap ref: #SO-300. See docs/design-system-2026-04-26.md §2 and docs/design-handoff-2026-04-26.md #SO-300 for full spec." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): shared <head> partial with SEO + canonical + JSON-LD slot" \
  "Roadmap ref: #SO-301. Folds in homepage Org schema, canonical tags, brand sameAs. See docs/design-handoff-2026-04-26.md #SO-301." \
  "enhancement,design-system,seo,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-btn button component (primary, ghost, mic)" \
  "Roadmap ref: #SO-302. See docs/design-system-2026-04-26.md §3.1." \
  "enhancement,design-system" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-state four-state pill (Indexed / Partial / Failed / Superseded)" \
  "Roadmap ref: #SO-303. The brand-promise made visual. See docs/design-system-2026-04-26.md §3.2." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-trust-band homepage trust strip" \
  "Roadmap ref: #SO-304. Codex recon's #1 homepage gap. See docs/design-system-2026-04-26.md §3.13." \
  "enhancement,design-system,plg-funnel" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-compare side-by-side grid (vs-pages + homepage)" \
  "Roadmap ref: #SO-305. Powers /vs-chatgpt-projects and homepage feature strip. See docs/design-system-2026-04-26.md §3.12." \
  "enhancement,design-system,marketing-content" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-stop-card safety interrupt component" \
  "Roadmap ref: #SO-306. See docs/design-system-2026-04-26.md §3.4. Used wherever safety keywords fire." \
  "enhancement,design-system,safety" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-price-card (3 variants — free, recommended, premium)" \
  "Roadmap ref: #SO-307. Three-tier pricing (\$0/\$97/\$497). See docs/design-system-2026-04-26.md §3.14." \
  "enhancement,design-system,plg-funnel" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-limits honesty list component" \
  "Roadmap ref: #SO-308. Powers /limitations. See docs/design-system-2026-04-26.md §3.15." \
  "enhancement,design-system,marketing-content" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): sun-readable mode toggle + localStorage persist" \
  "Roadmap ref: #SO-309. See docs/design-system-2026-04-26.md §2.2 + handoff #SO-309." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

# --- Surface refactors ---

create_issue \
  "feat(web): homepage refactor — L1 message + trust band + 3-card row + compareBlock" \
  "Roadmap ref: #SO-100. Closes #619 (naming inconsistency). See docs/design-handoff-2026-04-26.md #SO-100. Depends on #SO-300, 301, 302, 303, 304, 305, 306, 309." \
  "enhancement,plg-funnel,P0,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /cmms magic-link entry — replace beta form (extends #658)" \
  "Roadmap ref: #SO-070. Codex recon's top conversion fix. See docs/design-handoff-2026-04-26.md #SO-070." \
  "enhancement,plg-funnel,P0" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /limitations page (honest 'what we don't do yet')" \
  "Roadmap ref: #SO-005. Brand-promise extension. See docs/design-handoff-2026-04-26.md #SO-005." \
  "enhancement,marketing-content,P1,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /vs-chatgpt-projects comparison page" \
  "Roadmap ref: #SO-103. Lift from prototype X-tab. See docs/design-handoff-2026-04-26.md #SO-103." \
  "enhancement,marketing-content,seo,plg-funnel" \
  "$MILESTONE_P0"

# --- SEO + GEO ---

create_issue \
  "feat(web): schema.org TroubleshootingGuide + FAQ + HowTo on fault-code pages" \
  "Roadmap ref: #SO-110. Highest-impact SEO change in the roadmap. See docs/seo-geo-strategy-2026-04-26.md §1.4." \
  "enhancement,seo,P1" \
  "$MILESTONE_P0"

create_issue \
  "chore(web): robots.txt — explicit AI-crawler allowlist + scraper deny" \
  "Roadmap ref: #SO-113. See docs/seo-geo-strategy-2026-04-26.md §2.2." \
  "seo,geo,P1" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /llms.txt + /llms-full.txt (GEO foundation)" \
  "Roadmap ref: #SO-114. See docs/seo-geo-strategy-2026-04-26.md §2.4." \
  "enhancement,seo,geo,P1" \
  "$MILESTONE_P0"

create_issue \
  "ops: submit factorylm.com to Bing Webmaster + Brave Search Console" \
  "Roadmap ref: #SO-115. Bing powers ChatGPT/Copilot retrieval; Brave powers Perplexity. See docs/seo-geo-strategy-2026-04-26.md §2.3." \
  "seo,geo,P2,infra" \
  "$MILESTONE_P0"

create_issue \
  "ops: verify Google Search Console + submit sitemap" \
  "Roadmap ref: #SO-116." \
  "seo,P1,infra" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): internal-link every fault-code page to 3 siblings + index + /projects" \
  "Roadmap ref: #SO-118. Boosts crawlability + page authority + conversion path." \
  "seo,enhancement,P2" \
  "$MILESTONE_P0"

create_issue \
  "docs(geo): weekly LLM-citation probe (wiki/geo-probe.md)" \
  "Roadmap ref: #SO-128. See docs/seo-geo-strategy-2026-04-26.md §2.9. Manual ritual; ~30 min/week." \
  "geo,docs,P2" \
  "$MILESTONE_P0"

# --- Hub bugs (codex recon) ---

create_issue \
  "bug(hub): /hub/assets redirects to login from a signed-in page" \
  "Roadmap ref: #SO-200. Found by codex recon 2026-04-25. See docs/recon/factory-ai-hub-2026-04-25/recon-notes.md." \
  "bug,hub,P0" \
  "$MILESTONE_P0"

create_issue \
  "bug(hub): /hub/usage browser load error after reload" \
  "Roadmap ref: #SO-203. Found by codex recon 2026-04-25." \
  "bug,hub,P0" \
  "$MILESTONE_P0"

create_issue \
  "bug(hub): WO wizard step 1 button labeled 'Save' despite 3-step flow" \
  "Roadmap ref: #SO-204. Found by codex recon 2026-04-25." \
  "bug,hub,P1" \
  "$MILESTONE_P0"

# --- Stranger smoke + ops ---

create_issue \
  "feat(ops): stranger end-to-end smoke test gating deploys" \
  "Roadmap ref: #SO-211. Throwaway gmail → register → Stripe test → activation email → first chat in <10 min. Should run in CI on every push to main." \
  "testing,infra,P0" \
  "$MILESTONE_P0"

create_issue \
  "ops: fix mike@factorylm.com MX so outbound delivers (Apr 24 bounce)" \
  "Roadmap ref: #SO-003. Without this, every outbound from a factorylm.com sender fails. Critical for sticker drop, investor email, Markus/Thomas re-pitch." \
  "infra,sales,P0" \
  "$MILESTONE_P0"

# --- Defer Q3/Q4 — label only, do not close ---
echo ""
echo "=== DEFERRING Q3/Q4 issues ==="
for n in 579 580 470 581 564 567 569 572 573 578; do
  if gh issue edit "$n" --repo "$REPO" --add-label "defer-q3-2026" 2>/dev/null; then
    echo "  defer-q3-2026 -> #$n"
  else
    echo "  (skip #$n - already labeled or does not exist)"
  fi
done

# --- Close duplicates of #653 ---
echo ""
echo "=== CLOSING eval duplicates (#525, #596, #597) ==="
for n in 525 596 597; do
  if gh issue comment "$n" --repo "$REPO" \
        --body "Closing as duplicate of #653 - same root cause (pipeline-wide outage post-PR-#610 cascade or Doppler env). Tracking the fix on #653." 2>/dev/null \
     && gh issue close "$n" --repo "$REPO" --reason "not planned" 2>/dev/null; then
    echo "  closed #$n"
  else
    echo "  (skip #$n - may already be closed)"
  fi
done

# --- Close #440 — qr-onboarding skill already shipped ---
echo ""
echo "=== CLOSING shipped issues ==="
if gh issue comment 440 --repo "$REPO" \
      --body "Closing - skill shipped on codex/repo-sync-baseline branch in commit f26b527. See .agents/skills/qr-onboarding/SKILL.md." 2>/dev/null \
   && gh issue close 440 --repo "$REPO" --reason "completed" 2>/dev/null; then
  echo "  closed #440"
else
  echo "  (skip #440 - may already be closed)"
fi

echo ""
echo "DONE. Verify with:"
echo "  gh issue list --repo $REPO --milestone \"$MILESTONE_P0\" --state open"
echo "  gh issue list --repo $REPO --label defer-q3-2026"
