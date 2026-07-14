# Unknowns

Open questions and unverified inferences. Moving an item out of here requires code-level evidence.

## Repo-level
- **U1** — Purpose/status of the 9 undocumented `mira-*` modules (see gaps G1). Each: real service? bench tool? dead? (Phase 2)
- **U2** — Does `mira-ops` still exist under another path, or was it removed? (Phase 2; gaps G2)
- **U3** — Exact relationship MIRA ↔ factorylm: superseded / shared-lib / parallel product? (Phase 3; gaps G3)
- **U4** — MIRA_PLC internals — not cloned. Requires a private clone to catalog. (follow-up)
- **U5** — Are the "merged into monolith" archived repos actually present in factorylm's tree today? (code check; gaps G6)

## Active-supporting set (8 non-archived, role not code-verified)
- **U6** — `adversarial-dev`, `dotfiles`, `academic-partners` and the 5 other non-archived repos classified
  `active-supporting` by heuristic (not-archived) — confirm actual role vs. dormant. (light Phase 2)

## Phase 4 (dependency/security)
- **U7 — RESOLVED (negative).** No scanner (`syft`/`osv-scanner`/`semgrep`/`trivy`/`grype`) is installed on CHARLIE.
  SBOM/CVE evidence is therefore **owed** — install a scanner and run a real pass. See `dependencies/README.md`, gaps G13.

## Resolved in Phase 2
- **U1 — RESOLVED.** All 9 undocumented modules identified (services.yaml).
- **U2 — RESOLVED.** `mira-ops` does not exist; it's a stale repo-map entry (observability = compose file).
