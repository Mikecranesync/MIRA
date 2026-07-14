# Dependencies & Security Inventory (Phase 4)

Commit cde2c418. **Scanner tooling is NOT installed on CHARLIE** — `syft`, `osv-scanner`,
`semgrep`, `trivy`, `grype` all absent (verified `command -v`). So SBOM + CVE evidence is
**not available this run**; this inventory is **manifest-based** (deterministic, from git-tracked
manifests) plus base-image pinning review. Treat scanner-derived claims as owed follow-up (unknowns U7).

## Manifest inventory (MIRA, confirmed via `git ls-files`)

| Ecosystem | Manifest | Count |
|---|---|---|
| Python | `pyproject.toml` | 11 |
| Python | `requirements*.txt` | 21 |
| Node/Bun/TS | `package.json` (tracked, excl. node_modules) | 9 |

Python is `uv`-managed, target 3.12 (`.claude/rules/python-standards.md`). Node/TS spans mira-hub
(Next.js), mira-web (Bun), mira-machine-logic-graph (Bun), mira-scan-monday/frontend (Vite/React),
ladder-logic-editor (separate repo).

## Base images (prod/saas/hub compose)

| Image | Pinned? |
|---|---|
| `postgres:16-alpine` | ✅ |
| `redis:7.4.2-alpine` | ✅ |
| `apache/tika:3.1.0.0-full` | ✅ |
| `ghcr.io/open-webui/open-webui:v0.8.10` | ✅ |
| `nangohq/nango-server:hosted` | ❌ **floating tag** |

**Finding G12 — unpinned base image.** `nangohq/nango-server:hosted` uses a floating `:hosted` tag,
violating the CLAUDE.md container rule ("pinned image versions", `.ast-grep-rules` / security-boundaries
forbids `:latest`/`:main`). Non-reproducible + supply-chain risk. Recorded in `../gaps-and-risks.md`.
(MIRA's own service images are built from local Dockerfiles, not pulled by floating tag.)

## Secrets-risk posture (no values, structural only)

- All secrets are Doppler-managed (`factorylm/{dev,stg,prd}`); `.env` files are not committed.
- Enforced by `gitleaks protect --staged` (pre-commit) + `.ast-grep-rules/hardcoded-secret.yml` (every PR).
- Rotation flagged in security-boundaries: `WEBUI_SECRET_KEY`, `MCPO_API_KEY` (both in git history).
- **No scanner-based secret sweep run this pass** (semgrep/gitleaks-history not executed) — follow-up.

## Externally-exposed services (prod)

- mira-pipeline `:9099` (PIPELINE_API_KEY), mira-mcp REST `:8001` (MCP_REST_API_KEY), Open WebUI (OPENWEBUI_API_KEY),
  mira-relay (RELAY_API_KEY), mira-hub `app.factorylm.com` (NextAuth/RLS), mira-web `factorylm.com` (JWT).
- Full auth matrix: `.claude/rules/security-boundaries.md` § API Auth.

## facts

```yaml
facts:
  - fact: "Scanner tooling (syft/osv-scanner/semgrep/trivy/grype) is not installed on CHARLIE; no SBOM/CVE evidence this run."
    repository: MIRA
    file: catalog/dependencies/README.md
    detection_method: manual-reasoning
    confidence: confirmed
    last_verified: "2026-07-14"
  - fact: "MIRA has 11 pyproject.toml, 21 requirements*.txt, and 9 package.json manifests (git-tracked)."
    repository: MIRA
    file: pyproject.toml
    detection_method: ls
    confidence: confirmed
    last_verified: "2026-07-14"
  - fact: "The prod compose pulls nangohq/nango-server with the floating :hosted tag (unpinned) — violates the pinned-image rule."
    repository: MIRA
    file: docker-compose.saas.yml
    detection_method: rg
    confidence: confirmed
    last_verified: "2026-07-14"
```
