# MIRA End-of-Day Code Review — 2026-05-29

**Reviewer:** Claude (Cowork) | **Mode:** Full quality pass | **Scope:** All 6 substantive branches with commits today

> Severity bands: **BLOCKER** (must fix before merge), **P1** (fix before deploy to prod), **P2** (fix in follow-up, non-blocking), **nit** (style/polish).

---

## TL;DR

| Branch | Verdict | Top finding |
|---|---|---|
| `feat/hub-folder-brain` | Merge after **P1s fixed** | No PII sanitization in cascade call (mirrors Python rule); UUID regex too loose |
| `feat/hub-command-center` | **BLOCKER** | Server-side SSRF in `probe()` — arbitrary host fetch from DB row |
| `feat/uns-node-knowledge` | Split before merge | Duplicate migration + scope creep (PLC drafts, marketing data, lead-hunter state mixed in) |
| `feat/agents-celery-routines` | Merge after format | ruff format pending; otherwise clean, report-only design respects safety floor |
| `feat/hub-discovery-scan` | Merge | Clean v1 — well-documented in-memory store; fieldbus-readonly honored |
| `feat/conveyor-one-click-launchers` | Mostly docs | Shell scripts inline Python — minor injection surface via `$DEMO_PLC_IP` |

**One BLOCKER (Command Center SSRF) and three P1s** stand between this branch set and a clean prod deploy. Everything else is mergeable with small follow-ups.

---

## 1. `feat/hub-folder-brain` — Slices 1–4 + tests

**Scope:** 7 commits, 17 files, +1,954 / −30. Schema migration, PDF→knowledge_entries ingest, subtree-scoped BM25 retrieval, node Ask-MIRA chat with citation chips, e2e + unit tests.

### What's right

- **UNS gate satisfied by construction.** Node selection in the breadcrumb panel *is* the confirmation — comments call this out explicitly. Compliant with `.claude/rules/uns-confirmation-gate.md`.
- **Safety hard-stop runs before any LLM call** (route.ts ll. 224–246). Pre-LLM keyword scan returns SSE-streamed safety message and sets `X-Safety-Stop` header. Tested in `__tests__/route.test.ts`.
- **No tenant-wide fallback in `retrieveNodeChunks`** — empty subtree returns `[]` ("no coverage") instead of widening to the whole corpus. The grounding contract is preserved.
- **RLS discipline** — `withTenantContext` wraps every DB read; the comment on `retrieveNodeChunks` accurately explains why chunk-side `metadata->>'node_id'` is used instead of joining `doc_id → hub_uploads.kg_entity_id` (hub_uploads has no RLS grant for `factorylm_app`).
- **Migration 030 is safe** — additive + nullable, DOWN script provided, indexes are partial (`WHERE … IS NOT NULL`) so legacy rows don't pay GIN cost.
- **Client-supplied `system` messages stripped** (`messages.filter((m) => m.role !== "system")`) — basic prompt-injection floor.
- **Test coverage** — 6/6 unit pass (safety stop, 404, 503/401/400); 2/2 e2e proof against dev Neon + real Groq with cited answer.

### P1 — fix before prod

1. **No PII sanitization in the Hub cascade path.** The TS chat route sends `lastUser.content` + manual chunks straight to Groq/Cerebras/Gemini. `security-boundaries.md` says `InferenceRouter.sanitize_context()` is **default-on inside `InferenceRouter.complete()`** for the Python cascade — IP/MAC/serial-number redaction. The Hub route has no equivalent. Manual chunks pulled from `knowledge_entries` could legitimately contain serial numbers and IPs from OEM wiring docs; the user message could contain a fault dump with a MAC. Today's diff puts both into the prompt unfiltered.
   *Fix:* port `sanitize_context` to TS (`mira-hub/src/lib/sanitize.ts`), apply to both the user-message tail and each manual chunk's `content` before building `fullMessages`. Same regex set: IPv4 → `[IP]`, MAC → `[MAC]`, serials → `[SN]`.

2. **UUID regex is too permissive.** `/^[0-9a-f-]{36}$/i` (route.ts l. 203 + files/route.ts ll. 41, 90) accepts e.g. `------------------------------------` (36 hyphens) and would fall through to the DB query. Use the strict pattern already present in `command-center/display/[id]/route.ts`: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

3. **No request-body size or message-count limit.** A user could POST a 50 MB JSON `messages` array. Next.js has a 1 MB default but `force-dynamic` routes can override. Add an explicit length check on the JSON, plus a cap on `messages.length` (e.g. 20).

### P2

4. **Post-hoc safety alert.** `scanBoth(userText, fullResponse, …)` runs *after* the model has finished streaming to the client. A safety-triggering response is delivered first, alert fires after. Defense in depth — the keyword pre-check is the primary gate, this is reporting — but worth a comment in code so future readers don't conflate the two.

5. **`MIME_ALLOWLIST` is too broad.** `"image/"` includes `image/svg+xml`, which can carry JS. If non-indexable uploads ever get rendered back (no endpoint today), an attacker-uploaded SVG executes from the Hub origin. Either explicitly enumerate image subtypes or strip `image/svg+xml` from the allowlist now.

6. **`file.size` is trusted before reading bytes** (files/route.ts l. 106). `file.size` is browser-provided; a client could lie. Bytes are read regardless via `file.arrayBuffer()` — at 10 MB cap × N concurrent uploads, memory pressure is bounded but the check belongs after `Buffer.from(...)` too: `if (buffer.length > MAX_BYTES) return 413`.

7. **No client-disconnect handling.** The SSE stream keeps reading from the upstream provider after the client drops. Add `req.signal` propagation into `streamFromProvider`'s `AbortSignal` so aborted requests don't keep hitting Groq/Cerebras.

8. **Code duplication acknowledged.** Slice-3 commit message flags consolidation of cascade + safety phrases as follow-up. Karpathy-3 (Surgical Changes) supports keeping the asset chat path untouched for the demo. Ack — open a follow-up issue rather than refactor now.

### Nits

- `chunkText` loop guard: `Math.max(end - overlap, i + 1)` is safe today (overlap=120, size=1000) but if someone later sets `overlap >= size`, it loops. Add `if (overlap >= size) throw new Error("invalid")` at top.
- `sourceUrl = \`node-doc/${upload.id}/${filename}\`` — filename comes from `File.name`, which can include `/`. Sanitize to a basename before splicing into the URL key (also affects the partial UNIQUE constraint).

---

## 2. `feat/hub-command-center` — UNS tree + live-display green dots (Phase 1)

**Scope:** 3 commits, 22 files (note: includes `tools/agents/*` identical to `feat/agents-celery-routines`), +1,389 / −2. New `/command-center` tab, `display_endpoints` table with RLS, server-side reachability probe, e2e tests.

### What's right

- **Migration 030 is well-shaped** — CHECK constraints on `scheme` ('http'|'https') and `display_type` (4-value enum) block `javascript:` and other schemes at the DB; partial unique on `(tenant_id, uns_path)`; RLS policy + `factorylm_app` GRANT mirroring migration 020.
- **Nav restricted to `ADMIN_ROLES`** in `access-control.ts` — technicians don't see Command Center.
- **`display/[id]/route.ts` is read-only by design**, cites `fieldbus-readonly.md`, exports only GET (POST/PUT/PATCH/DELETE return Next.js's default 405).
- **Liveness semantic is correct** — "is the display reachable RIGHT NOW", not PLC-signal freshness. The doc comment explains why this is the right primitive.
- **Known-issues entry filed** for the colliding `live_signal_cache` DDL in `tools/demo_plc_poller.py` rather than papering over it.

### BLOCKER — fix before any merge to main

9. **Server-side SSRF in `probe()` (tree/route.ts ll. 178–203).** Every request to `/api/command-center/tree` triggers `fetch(\`${scheme}://${host}${port}${path}\`)` against arbitrary host strings stored in `display_endpoints.host`. Even with `scheme` constrained to http/https, `host` is **arbitrary text**. A tenant admin (or attacker who compromises an admin session) can store:
   - `host=169.254.169.254` → exfiltrates cloud metadata creds in any cloud deploy
   - `host=127.0.0.1, port=5432` → probes internal Postgres / Redis / Vault
   - `host=metadata.google.internal` → GCP metadata service
   - `host=internal-vault.lan` → Tailscale/LAN-side service the Hub can reach but the user can't
   
   Phase-1 (Charlie local) blast radius is small. But the migration is on the gated `apply-migrations.yml` path → it ships to prod. The probe code does **not** check what environment it's in. Once Hub runs in the cloud, every tenant gets a free credentialed SSRF.
   
   *Fix (any of, pref. 2+3):*
   1. Allowlist host strings to RFC 1918 + Tailscale CGNAT (`100.64.0.0/10`) + explicit per-tenant tunnel domain.
   2. Block link-local (169.254/16), loopback (127/8, ::1), private metadata (`metadata.google.internal`, `metadata.azure.com`, etc.) at probe time.
   3. Disable server-side probe in cloud Hub until the on-prem reverse-proxy phase ships — return `live: null` or skip probe.
   4. Constrain the `host` column with a CHECK or app-level regex (`^[a-z0-9.-]+$`) — necessary but not sufficient.

10. **302 redirect target is admin-controlled** (`display/[id]/route.ts` l. 75). Lower-severity than the SSRF (browser-side blast, not server-side) but a tenant admin can register `host=evil.example.com` and redirect users into a credential-harvesting page that looks like an HMI. Same allowlist + check applies. The CHECK on `scheme` already blocks `javascript:`/`data:` — good.

### P1

11. **`scheme=https` + `host=evil.example.com` can framebust if iframe `sandbox` is missing.** Check `command-center/page.tsx` — if the iframe lacks `sandbox` + a tight `allow` list, a hostile HMI page can navigate the parent. (I didn't read all 294 lines of page.tsx — verify before merge.)

12. **No rate limit on `/api/command-center/tree`.** Each call probes every display per tenant; 10s cache helps but a fresh tenant with 100 fake display rows = 100 outbound fetches per request. Add a `liveCount` cap and/or per-tenant request rate limit.

### P2

13. **Probe `fetch` has no User-Agent** — minor reconnaissance hygiene; some WAFs log/block "no UA".
14. **`port` is INTEGER with no upper bound at DB.** Add `CHECK (port BETWEEN 1 AND 65535)`.

---

## 3. `feat/uns-node-knowledge` — ADRs + spec + migration + eval runs

**Scope:** 3 commits, 17 files, +2,502 / −4. Largely docs (ADR-0019/0020, spec, plan, 3 eval runs), one duplicate migration, PLC v1.6 drafts, marketing data, lead-hunter state.

### What's right

- **ADR-0019 quality is high** — explicit "Decision", architecture table, rationale grounded in the 33 MB Rockwell manual incident, OOM history cited, KG promotion model (`tech` / `admin` / `system_consensus`) — this is exactly what `mira_security_checklist` expects from a design-lock doc.
- **`docs/specs/uns-node-centric-knowledge-spec.md`** is the contract the folder-brain code claims to implement; the alignment looks good.

### BLOCKER — must resolve before merge

15. **Duplicate migration file.** This branch carries `docs/migrations/009_knowledge_entries_chunk_anchors.sql`. The same DDL — verbatim — already lives at `mira-hub/db/migrations/030_knowledge_entries_chunk_anchors.sql` (commit `4c13aa1f`, already on main). The CLAUDE.md / 030 header even says the move was deliberate: only `mira-hub/db/migrations/*.sql` rides `apply-migrations.yml`; `docs/migrations/` has no runner. If both branches merge, the docs/ copy is dead text — not catastrophic — but the file shouldn't be there. *Fix:* `git rm docs/migrations/009_knowledge_entries_chunk_anchors.sql` before merge.

### P1 — Karpathy-3 violation

16. **Scope creep.** Branch is titled UNS node-knowledge design lock but bundles:
   - `plc/Conv_Simple_1.6/*` — 4 files, 720 lines of PLC v1.6 drafts (RTU read+write, F1-F9 retraction)
   - `marketing/prospects/hardening-alerts.jsonl` — single-row prospect data
   - `tools/lead-hunter/.hourly_state.json` — tooling state
   - `docs/context/PROGRESS.local.md` — local dev journal (already in `.gitignore` per a later commit; was this slipped in before that?)
   
   Each of these belongs on its own branch. The PLC drafts in particular touch fieldbus territory — they deserve a focused review under `.claude/rules/fieldbus-readonly.md` and `python-standards.md`. *Fix:* `git restore --source=origin/main -- plc/ marketing/ tools/lead-hunter/ docs/context/PROGRESS.local.md` and cherry-pick those into their own branches.

### Nits

17. The `mira-hub/src/lib/uploads.ts` diff here is a **strict subset** of the diff on `feat/hub-folder-brain`. They will merge cleanly (additive lines), but two parallel edits to the same exported interface is a smell. Pick one branch to land the uploads.ts change.

---

## 4. `feat/agents-celery-routines`

**Scope:** 2 commits, 17 files, +1,145 / −2. *Note:* this branch's commits also live on `feat/hub-command-center` (Command Center commit was made on top of this base) — the `tools/agents/` diff is byte-identical between the two.

### What's right

- **Report-only by design.** `pr_merge_sweep`, `stale_branch_cleanup`, `uncommitted_work_nag`, `adversarial_triage` — all return JSON, none mutate. Comment in `pr_merge_sweep` explicitly notes "Auto-merge is intentionally disabled — CLAUDE.md requires confirming failing checks against main before merging." Respects `mira_definition_of_done` and the human-in-the-loop floor.
- **`_run()` is safe** — `subprocess.run(cmd, …)` with list args (never `shell=True`), explicit `timeout`, captures stdout/stderr to a log file. `task_acks_late=True` + `task_reject_on_worker_lost=True` for reliability.
- **Localhost-only Redis** (broker `redis://localhost:6379/0`) — CHARLIE dev-loop only, no cloud exposure.
- **ruff check: PASSES** (no lint errors).

### Nit

18. **ruff format: 2 files would reformat** (`tools/agents/celery_app.py`, `tools/agents/tasks.py`). Run `ruff format tools/agents/` before merge. `python-standards.md` makes ruff format the CI gate.

19. **`_log` writes JSON files unbounded by retention.** Add a 30-day rotation or move to `logs/.gitignore` (the .gitignore is there ✓ but disk grows forever).

---

## 5. `feat/hub-discovery-scan`

**Scope:** 5 commits, 16 files, +1,069 / −346 (the −346 is mostly HANDOFF.md and PLAN.md rewrites). New `/discovery` page, `POST /api/discovery` validate-and-store, in-memory per-tenant latest-only store, unit + e2e tests.

### What's right

- **Validation is defensive.** `validateInventory()` enforces schema tag, type-checks every field, allowlist for `tier`, lenient on optional fields. Returns typed `ValidationResult` so the route can `400` cleanly.
- **In-memory store is explicitly v1.** Comment block calls out the three limitations (lost on restart, not multi-instance, latest-only) and references PLAN.md + HANDOFF.md. The deferral is honest and reviewable.
- **Fieldbus-readonly preserved.** Hub *displays* inventory — never executes `discover.py`, never writes to the network. `lib/discovery.ts` head comment makes this explicit.
- **No write path from the CLI today** — well-documented; service-token push is a deferred follow-up.

### P2

20. **No size limit on POST body.** `req.json()` will accept arbitrarily large payloads. Cap to (say) 1 MB.
21. **In-memory store + multi-instance risk** is documented but if the Hub ever runs behind a multi-replica deploy, a user upload "lands" on one replica and reads from another return null. Add a runtime warning to the route if `process.env.HUB_REPLICA_COUNT > 1` (or whatever signal exists).

### Nit

22. HANDOFF.md churn (−346/+) suggests the doc was largely rewritten. That's fine for a planning doc; mention it in PR description so reviewers don't try to diff-read it.

---

## 6. `feat/conveyor-one-click-launchers`

**Scope:** 5 commits, 13 files, +1,579 / −5. Mostly docs (`PROGRESS.md`, competitor analysis, eval runs, PDF, marketing data), one wiki update, two shell launcher scripts.

### What's right

- **Tier-1/Tier-2 split is clean** — `start-conveyor-terminal.command` does no Docker, just PLC + Rich UI; `start-conveyor.command` brings up Node-RED + relay. Good UX layering.
- **PLC probe is read-only** (TCP connect to :502, immediately close). Honors fieldbus-readonly.

### P2 — shell injection surface

23. **`$DEMO_PLC_IP` is interpolated into a Python `-c` string** (both `.command` files). A user with control over the env var (e.g. set in `.zshrc` by malicious cocktail napkin) can inject Python. Practical risk: low (it's the *user's* own machine, the user already controls more). The right pattern is `python3 -c "$SCRIPT" "$PLC_IP"` and `socket.connect((sys.argv[1], 502))`.
24. **`set -u` only.** Add `set -eo pipefail` so failures in `docker compose up` or `python3 -c` actually stop the script rather than continuing with a stale variable.

### Nits

25. Hardcoded `192.168.1.100` — fine for the garage; surface as env var with the existing `DEMO_PLC_IP` default once a second customer exists.
26. `marketing/prospects/hardening-alerts.jsonl` and `tools/lead-hunter/.hourly_state.json` showed up here too — same scope-creep issue as the uns-node-knowledge branch. These should be their own commit/branch.

---

## Cross-cutting findings

| Theme | Severity | Affected branches |
|---|---|---|
| **No TS-side PII sanitizer** | P1 | folder-brain (and any future Hub LLM caller) |
| **SSRF via DB-stored URLs** | BLOCKER | command-center |
| **Loose UUID regex copy-pasted** | P1 | folder-brain (chat + files routes) |
| **Scope creep on `marketing/`, `tools/lead-hunter/`, `plc/`** | P1 (process) | uns-node-knowledge, conveyor-launchers |
| **ruff format pending** | nit | agents-celery |
| **Code duplication of cascade/safety** | P2 (known) | folder-brain |

## Recommended merge order

1. **`feat/hub-discovery-scan`** — clean, mergeable as-is (apply P2s in follow-up).
2. **`feat/agents-celery-routines`** — after `ruff format tools/agents/` + log rotation note.
3. **`feat/conveyor-one-click-launchers`** — after splitting marketing/lead-hunter into its own branch + the shell hardening above.
4. **`feat/hub-folder-brain`** — after the 3 P1s (sanitizer, UUID regex, body cap).
5. **`feat/uns-node-knowledge`** — only after the duplicate migration is removed and the PLC/marketing/lead-hunter files are pulled out. Then the docs land cleanly.
6. **`feat/hub-command-center`** — gated behind the SSRF fix. The Phase-1 (Charlie local) value is real, but this code will eventually run in cloud, and the migration ships via the gated path. Fix once, ship once.

## What I didn't fully cover

- Full `tsc --noEmit` and `pnpm test` runs on `mira-hub` (slow in this sandbox; staging gate is the right place).
- `command-center/page.tsx` iframe `sandbox`/`allow` attributes (read summary only; verify before merge).
- E2E test reliability against the staging Neon branch — HANDOFF flags an unrelated LLM-eval flake.
- The PLC v1.6 drafts in `feat/uns-node-knowledge` — fieldbus-readonly review deferred until those move to their own branch.

---

*Generated by Cowork from end-of-day branch sweep on 2026-05-29. Findings keyed to file paths and line ranges where given; severity assignments follow `automated_run_gates` + `mira_security_checklist` + `karpathy-principles`.*
