# Declared-vs-Observed Drift Report — Gate 0

**Date:** 2026-08-15 · **Method:** 10 read-only explorer agents, every finding file:line-cited; claims tested against code/config, not prose.
**Doctrine:** `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` §5 — a disagreement between declared and observed architecture is a drift finding; it must not be silently "fixed" by an implementation agent.

## Verdict summary

| # | Declared claim | Verdict | Severity |
|---|---|---|---|
| 1 | Cascade is Groq→Cerebras→Together, no Anthropic in diagnosis | **CONFIRMED** (`mira-bots/shared/inference/router.py:204-268`) | — |
| 2 | Open WebUI fully removed from prod | **CONFIRMED** (`docker-compose.saas.yml:61-69`) | — |
| 3 | mira-sidecar "sunset pending" (root CLAUDE.md) | **STALE-DOC** — sunset already **landed 2026-05-20**; not in saas.yml | low |
| 4 | mira-connect deferred/dormant | **CONFIRMED** | — |
| 5 | mira-relay active SaaS-only | **CONFIRMED** (`docker-compose.saas.yml:548-582`) | — |
| 6 | Version derived from git tag, no /VERSION | **CONFIRMED** (`version-tag.yml`) | — |
| 7 | Root CLAUDE.md container map | **DRIFTED** — mira-mcp ports claimed 8000/8001, actual `8009:8000, 8010:8002`; **mira-docling listed but no container exists**; mira-web missing from map; atlas-api not in saas.yml | medium |
| 8 | CLUSTER.md node roles (Qdrant :8000 CHARLIE, Ollama :11434 BRAVO) | **CONFIRMED as declared** (runtime not independently probed) | — |
| 9 | `docs/specs/hub-mobile-spec.md:18` — "Native iOS/Android apps (not built; PWA is the strategy)" | **DRIFTED — superseded in fact** by `mira-mobile/` (Capacitor 8, ADR-0034, PRs #3222/#3234/#3240/#3241). The spec was never updated. | **high** |
| 10 | ADR-0033 one-technician-brain "Proposed — awaiting Mike" | **DRIFTED** — code already depends on the contract (`mira-bots/shared/technician_context.py:77`, engine call sites). Status says Proposed; architecture behaves as ratified (flag default-off, but structure adopted). | medium |

## Findings requiring action (feed the backlog)

### D-1 (high) — hub-mobile-spec contradicts shipped reality
`docs/specs/hub-mobile-spec.md` still declares native apps out of scope while `mira-mobile/` ships behind ADR-0034 (Proposed, reviewed) and PRD 2026-08-13. Two authoritative-looking documents now disagree. **Fix:** supersession header on hub-mobile-spec pointing at ADR-0034; ADR-0034 + mobile PRD become the declared mobile architecture. *Human input:* none needed beyond review — the code decision is already merged.

### D-2 (medium) — root CLAUDE.md container map is wrong in 4 places
Phantom `mira-docling` entry, wrong mira-mcp ports, missing mira-web, atlas-api listed but absent from saas.yml. Agents plan against this table. **Fix:** regenerate the map from the compose files (machine-validated, §11), or delete the table and point at compose.

### D-3 (medium) — ADR-0033 status vs adoption
The context-contract seam is wired (default-off) while the ADR says Proposed/awaiting-Mike. This is exactly the §13 blind spot "agents operating from stale remembered context" in reverse — the doc understates reality. **Fix:** decision belongs to Mike: either ratify (status → Accepted, note the flag gate) or explicitly mark the wiring experimental in the ADR. Registry lists the drift either way.

### D-4 (low) — root CLAUDE.md sidecar line
"Sunset pending OEM migration" describes May. Sidecar is out of prod; directory remains. **Fix:** one-line doc update + registry `LEGACY`, deletion tracked separately under Gate 11.

### D-5 (medium) — asset-tag grammar diverges between Hub and Mobile
`mira-hub/src/lib/asset-tag.ts:11` forbids dots (`^[A-Za-z0-9_-]{1,64}$`, traversal defense); `mira-mobile/src/lib/tags.ts:7` allows dots (`[A-Za-z0-9._-]{1,63}`) while its comment claims "Hub semantics". A tag that parses on mobile can 404 on Hub. This is cross-repo-contract drift (§13.12) inside one product flow (QR → asset). **Fix:** CU-P1 pilot (see BACKLOG.md) — extract one tag-grammar contract, conform mobile, behavior-lock both sides.

## Non-drift observations worth recording

- The prod deploy path, versioning, provider cascade, env separation, and OW removal all **match their documentation** — the highest-blast-radius claims are the accurate ones.
- `factorylm_ai/` is a **MIRA-internal** library (top-level dir in the MIRA repo) despite the name; `printsense/interpret.py` importing it is an in-repo dependency, not a cross-repo runtime edge. The name invites the confusion; registry notes it.
- **Zero cross-repo runtime calls found**: MIRA prod (VPS) and factorylm (cluster/local) are operationally decoupled. The convergence is therefore about *truth and code ownership*, not about untangling a live distributed system — materially lower risk than the doctrine's worst case.
