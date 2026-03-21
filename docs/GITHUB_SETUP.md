# MIRA — GitHub Setup Guide

One-time setup steps that cannot be done via files in the repo.

---

## Branch Protection (one-time, GitHub UI)

1. Go to `github.com/Mikecranesync/MIRA/settings/branches`
2. Add rule for branch: **main**
   - [x] Require status checks to pass before merging
     - Required checks: `lint-and-type-check`, `test-unit`, `license-check`, `docker-build-check`
   - [x] Require branches to be up to date before merging
   - [x] Do not allow bypassing the above settings

---

## GitHub Secrets Required (Settings → Secrets → Actions)

Add these secrets (values from Doppler `factorylm/prd`):

| Secret | Used by |
|--------|---------|
| `ANTHROPIC_API_KEY` | Any future integration tests |

No other secrets needed for CI — all tests are unit-only and require no live services.

---

## Travel Laptop Setup (clone and go)

Three commands, under 5 minutes:

```bash
git clone https://github.com/Mikecranesync/MIRA && cd Mira
doppler login && doppler setup --project factorylm --config prd
doppler run -- docker compose up -d && bash install/smoke_test.sh
```

### Prerequisites on travel laptop

- Docker Desktop installed and running
- `doppler` CLI installed: `brew install dopplerhq/cli/doppler`
- Git configured with SSH key or HTTPS credential

---

## Port Reference

| Service | Host Port |
|---------|-----------|
| Open WebUI / mira-core | 3000 |
| mira-mcpo | 8000 |
| mira-ingest | 8002 |
| mira-mcp | 8001 |
| Node-RED (mira-bridge) | 1880 |
| Teams bot | 8030 |
| WhatsApp bot | 8010 |
| Test runner results server | 8021 |

---

## CI Workflow Summary

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to main, dev | Lint → unit tests → license check → Docker build |
| `prompt-guard.yml` | push of `active.yaml` | Warn when production prompt changes |
| `dependency-check.yml` | Monday 9am UTC + manual | CVE scan, auto-creates issue on finding |
| `release.yml` | push of `mira-*-v*.*` tag | Auto GitHub Release with changelog notes |

### Triggering a release

```bash
git tag mira-ci-v0.5 -m "CI/CD live — lint, test, license, prompt-guard, dep-audit, auto-release"
git push origin main --tags
```

The `release.yml` workflow creates the GitHub Release automatically and extracts the matching section from `CHANGELOG.md` as the release body.
