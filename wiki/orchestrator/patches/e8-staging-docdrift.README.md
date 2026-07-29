# Patch: e8-staging-docdrift.patch

**Lens:** E (Promotion pipeline) · **Run:** E8 · **2026-06-15** · **Severity:** low (doc drift, not a beta blocker)

## What it fixes
`docker-compose.staging.yml` (+ `docker-compose.staging-vps.yml`) and the staging Telegram bot
(`@MiraStaging_bot`) all exist on `origin/main`, but two docs still mark them as open gaps:
- `CLAUDE.md` L45/L47 — `docker-compose.staging.yml *(TODO)*`, `@MiraStagingBot *(TODO)*`
- `docs/architecture/environment-quick-ref.md` L12/L19 — "Gap-1 — does not exist yet", "Gap-1/Gap-3 open"

The patch updates the env table + the summary line to reflect reality (Gap-1 + Gap-3 CLOSED).

## Apply (from a fresh branch off main — never on the 164-behind feature tree)
```bash
cd <MIRA repo>
git fetch origin main && git switch -c docs/e8-staging-docdrift origin/main
git apply --check wiki/orchestrator/patches/e8-staging-docdrift.patch   # must print nothing
git apply wiki/orchestrator/patches/e8-staging-docdrift.patch
```

## Verify
```bash
grep -nE "staging.yml|MiraStaging" CLAUDE.md docs/architecture/environment-quick-ref.md
# expect: no remaining "*(TODO)*" or "does not exist yet" on the staging compose / bot rows
```

## Residual (not in this patch — sweep separately if desired)
- `environment-quick-ref.md` L17 still has `@MiraStagingBot (**Gap-3 — does not exist yet**)` in the
  bot row, and L96 carries a "**Staging compose doesn't exist**" detail row. Left untouched to keep
  this patch to the two canonical table rows + summary; fold into the same PR if convenient.
- Bot naming: compose uses `@MiraStaging_bot`; docs historically wrote `@MiraStagingBot`. Patch
  standardizes on the compose value (the deployed truth).
