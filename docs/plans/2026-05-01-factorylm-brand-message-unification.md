# FactoryLM Brand Message Unification Plan

**Date:** 2026-05-01  
**Primary message:** MIRA is the AI troubleshooting workspace for industrial maintenance.  
**GitHub rollback point:** `2be1b03bc01ddd48474170dd935634adbef22ae3` on branch `feat/lsp-claude-code`  
**Rollback branch pushed to GitHub:** `rollback-factorylm-brand-message-2026-05-01`

## Goal

Unify `factorylm.com` around one product story:

> MIRA is the AI troubleshooting workspace for industrial maintenance.

FactoryLM is the company/site. MIRA is the product. The CMMS is not the product;
diagnosis is the product, and MIRA can write the resulting work back to a CMMS.

## Current Problem

The live site and repo copy use several competing frames:

- `AI workspace`
- `AI Troubleshooter`
- `FactoryLM CMMS`
- `Troubleshooter`
- `Projects`
- `MIRA Integrated`
- free/trial/get-started CTA variants

The strongest current material is the diagnosis-focused positioning in
`docs/runbooks/cmms-onboarding.md`: "The CMMS isn't the product. The diagnosis is."
The weakest material is anything that makes FactoryLM sound like a CMMS replacement.

## Message Architecture

Use this hierarchy everywhere:

1. **Company:** FactoryLM
2. **Product:** MIRA
3. **Category:** AI troubleshooting workspace for industrial maintenance
4. **Primary buyer promise:** Get cited fault diagnosis from your manuals, asset history, photos, and work orders.
5. **Workflow promise:** Techs can scan an asset, ask what is wrong, and get the next safe troubleshooting step.
6. **Integration promise:** MIRA works alongside MaintainX, Limble, UpKeep, and other CMMS tools; it does not replace them.

## Canonical Copy

Homepage hero:

```text
MIRA is the AI troubleshooting workspace for industrial maintenance.

Scan an asset, ask what is wrong, and get a cited answer from your manuals,
maintenance history, photos, and work orders. Built for the 2 AM fault call,
not generic office chat.
```

Short product description:

```text
MIRA helps maintenance teams diagnose equipment faults with answers grounded in
their own manuals, assets, and work history.
```

CMMS positioning:

```text
Keep your CMMS. Add MIRA for troubleshooting.

MIRA diagnoses the fault, then writes the work order back to the system your
team already uses.
```

Pricing positioning:

```text
One price for the plant floor.

MIRA is a flat site license, not a per-seat CMMS bill. Add technicians without
adding seats.
```

CTA vocabulary:

- Primary: `Start with MIRA`
- Secondary: `See pricing`
- Higher-intent sales/help: `Talk to Mike`
- Avoid as primary: `Get Started`, `Try free`, `Join Beta`, `Troubleshooter`

Plan names:

- `$97/mo`: `MIRA Troubleshooting Workspace`
- `$297/mo`: `MIRA + CMMS Write-Back`

If the no-free-tier decision still stands, do not say `free trial` or `try free`
on public pages. If the magic-link flow offers free usage, say the exact offer
instead, e.g. `Try 10 diagnostic questions` or `Start with a magic link`.

## Page-by-Page Plan

### 1. Homepage

Files:

- `mira-web/public/index.html`

Changes:

- Replace the hero headline and subheadline with the canonical message.
- Keep the MIRA vs ChatGPT comparison; it is the strongest proof section.
- Rename "Three kinds of Projects" to something more concrete, such as
  "Three troubleshooting workspaces."
- Keep "Asset Project", "Crew Project", and "Investigation Project" only if
  product UI actually uses those names. Otherwise rename to "Asset workspace",
  "Crew handoff", and "RCA investigation".
- Replace footer/nav `Troubleshooter` labels with `MIRA`.
- Resolve the homepage pricing mismatch: repo/live copy has referenced
  `$497/mo with auto-RCA + signed PDF` while pricing and terms use `$297/mo`
  for CMMS write-back.

### 2. Pricing

Files:

- `mira-web/public/pricing.html`
- `mira-web/public/terms.html`

Changes:

- Retain transparent pricing and site-license positioning.
- Change page title/meta from `FactoryLM AI Troubleshooter` to
  `MIRA Pricing — AI troubleshooting workspace for industrial maintenance`.
- Rename the second tier from `MIRA Integrated` to `MIRA + CMMS Write-Back`.
- Keep the "MIRA is a diagnostic AI layer, not a CMMS replacement" note.
- Ensure terms, pricing cards, FAQ, and homepage all agree on `$97` and `$297`.
- Confirm the checkout path does not redirect users to `?checkout=error` before
  deploying copy that drives paid intent.

### 3. CMMS / Activation Page

Files:

- `mira-web/public/cmms.html`

Changes:

- Change the page frame from `FactoryLM CMMS` to `MIRA`.
- Use the CMMS only as the workflow destination: MIRA diagnoses first, then can
  write back to CMMS.
- Replace "Open FactoryLM CMMS" with "Open MIRA".
- Preserve the magic-link activation flow if it is the current signup path.
- Use one CTA label: `Start with MIRA` or, if the exact mechanic matters,
  `Send me a magic link`.

### 4. Blog and SEO Surfaces

Files:

- `mira-web/src/lib/blog-renderer.ts`
- generated/static blog pages if committed
- `mira-web/public/privacy.html`
- `mira-web/public/terms.html`

Changes:

- Replace `Try free` with the chosen CTA.
- Point blog CTAs at MIRA, not generic CMMS.
- Keep maintenance-guide SEO pages; they are aligned with the buyer problem.
- Add a consistent product boilerplate near the blog CTA:
  `MIRA gives maintenance teams cited answers from their own manuals and asset history.`

### 5. Metadata and Open Graph

Files:

- `mira-web/public/index.html`
- `mira-web/public/pricing.html`
- `mira-web/public/cmms.html`
- `mira-web/src/lib/blog-renderer.ts`

Changes:

- Standardize titles around:
  - `FactoryLM — MIRA AI Troubleshooting Workspace`
  - `MIRA Pricing — FactoryLM`
  - `Start with MIRA — FactoryLM`
- Standardize descriptions around cited troubleshooting, manuals, asset history,
  and industrial maintenance.
- Keep `FactoryLM` as `og:site_name`.

## Verification Checklist

Before deploy:

```bash
rg -n "FactoryLM CMMS|AI Troubleshooter|Try free|Join Beta|Get Started|\\$497|free trial|Troubleshooter" mira-web/public mira-web/src/lib
cd mira-web && bun test
```

Manual review:

- Homepage says the canonical sentence above the fold.
- Pricing, terms, and homepage agree on price points.
- CTAs use one vocabulary.
- Site never implies MIRA replaces a CMMS.
- `/api/checkout/session` succeeds or paid CTAs do not point at a broken checkout.

Live checks after deploy:

```bash
curl -I https://factorylm.com
curl -L https://factorylm.com/pricing -o /tmp/factorylm-pricing.html -w "%{http_code}\n"
curl -L https://factorylm.com/cmms -o /tmp/factorylm-cmms.html -w "%{http_code}\n"
curl -L https://factorylm.com/blog -o /tmp/factorylm-blog.html -w "%{http_code}\n"
```

## Rollback

Rollback branch is already pushed to GitHub:

```bash
git fetch origin
git switch -c rollback-apply-factorylm-brand-message-2026-05-01 origin/rollback-factorylm-brand-message-2026-05-01
```

If a bad brand-copy deploy reaches production, redeploy from:

```text
origin/rollback-factorylm-brand-message-2026-05-01
```

For a branch-level revert instead of redeploying the rollback ref:

```bash
git revert <brand-unification-commit-sha>
```

Use the rollback branch when the issue is broad site behavior or deploy
uncertainty. Use `git revert` when the deployed commit is known and isolated.
