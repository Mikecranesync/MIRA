# Hot Cache — 2026-06-03 — Cloud (autonomous gap-closure driver)

## gap-closure-driver run — 2026-06-03 (run 3, ~09:15 UTC)

**Status confirmed — same stop condition as runs 1 and 2. No new work this run.**

### PR state (verified this run)
- **PR #1657** (`feat/dt2026-gap-closure`): Phases 0–5; base=main; compose-mem-lint ✅ (advisory); `mergeable_state: blocked` — awaiting human review/approval
- **PR #1674** (`feat/dt2026-rls-verification-1664`): RLS tests for #1664; stacked on #1657 (base=`feat/dt2026-gap-closure`); 0 check_runs (by design — migration-verify.yml only triggers on PRs targeting main); commit status "pending"
- **PR #1679** (`docs/gap-closure-status-sync-2026-06-03`): this status sync PR; staging-gate ✅ success
- **PR #1682** (`ci/staging-gate-content-scope`): staging-gate scope fix (#1680 — docs-only PRs skip the eval); `mergeable_state: blocked` — needs review

**2 of 2 gap-closure PR slots occupied (#1657, #1674). No new work started.**

### Stop reason
- PR limit: 2/2 feat/dt2026 PRs open
- Most recent gap-closure PR (#1674) has no CI result (stacked PR targeting non-main branch — expected)
- PR #1657 needs human review before it can merge and unblock the stack

### Next agent work order (when ≤1 slot open)
1. **#1662** — `kg_writer` → `relationship_proposals` helper (ADR-0017). Independent of migrations.
2. **#1658** — `direct_connection` UNS bypass in `ignition_chat.py`. Independent of migrations.
3. **#1659** — Citation enforcement + `TroubleshootingSession` lifecycle. Independent of migrations.
4. **#1663** — Hub `/proposals` surface fix. Soft-blocked on #1657 merge.

---

## gap-closure-driver run — 2026-06-03 (run 2, ~08:10 UTC)

**Status confirmed — same stop condition as run 1.**

Both gap-closure PRs remain open and green:
- **PR #1657** (`feat/dt2026-gap-closure`): Phases 0–5; base=main; 1 advisory CI check ✅; blocked on review
- **PR #1674** (`feat/dt2026-rls-verification-1664`): RLS tests for #1664; stacked on #1657; no CI checks (non-main target)

**2 of 2 gap-closure PR slots occupied. No new work started.**

Additional PRs observed open (not gap-closure per feat/dt2026 prefix rule):
- #1679 (this docs sync, draft) · #1682 (ci staging-gate) · #1681 (kg component proposals) · #1676 (canonical asset-graph docs) · #1675 (ci pipeline build check) · #1672 (kg reasoning trace) · #1671 (kg relationship enrich) · #1668 (Ignition self-serve module)

Next agent work order (unchanged): #1662 → #1658 → #1659 → #1663 (after ≥1 gap-closure PR merges).

---

## gap-closure-driver run — 2026-06-03 (run 1)

**Epic:** #1666 (DT-2026 gap closure — North Star: grounded UNS-gated maintenance copilot to first paying customer)
**Governed by:** `docs/plans/2026-06-01-mira-master-architecture-plan.md`

**Result: STATUS SYNC ONLY — at 2 open gap-closure PR limit. Waiting for human review / merge.**

### Open gap-closure PRs (2 of 2 — limit reached)

| PR | Branch | What | Base | CI | Mergeable |
|----|--------|------|------|----|--------|
| #1657 | `feat/dt2026-gap-closure` | Phases 0–5: repo audit, migrations 032–037 (`decision_traces`/`tag_events`/`flaky_input_signals`/`approved_tags`/`tag_event_diffs`), relay ingest API (HMAC+allowlist+UNS), Ignition collector, Command Center freshness (tag-based), tag-diff logger | `main` | 1 advisory check ✅ | blocked (needs human review) |
| #1674 | `feat/dt2026-rls-verification-1664` | RLS integration tests for tag/trace tables — closes #1664 | `feat/dt2026-gap-closure` (stacked) | no checks run yet | clean (no conflicts; merge after #1657) |

### Migrations on `main` (local checkout)
Up to `031_ignition_audit_log.sql`. Migrations 032–037 are in PR #1657 — not yet on main.

### Issue status (epic #1666 — preferred work order)

| Issue | Labels | Status | Note |
|-------|--------|--------|------|
| #1665 | P1, ready-for-human | **Blocked** — env gate | Promote 032-037 to staging/prod — human must run `apply-migrations.yml` |
| #1664 | security, P2, ready-for-agent | **IN PROGRESS** — PR #1674 | RLS verification tests stacked on #1657 |
| #1663 | bug, P1, ready-for-agent | **Queued** — BLOCKED on #1657 merge | Hub `/proposals` reads `relationship_proposals` only, not `ai_suggestions` |
| #1662 | P1, ready-for-agent | **Queued** | `kg_writer.py` auto-verifies edges at confidence=1.0; ADR-0017 helpers not yet created |
| #1661 | P1, ready-for-agent | **Queued** | Flaky-input/sensor-anomaly detector missing (`FlakyInputDetector` 0 hits) |
| #1660 | P2, ready-for-agent | **Queued** | `DecisionTraceWriter` missing; `trace_id=None` in prod |
| #1659 | P1, ready-for-agent | **Queued** | Citation compliance observe-only; troubleshooting-session lifecycle not wired |
| #1658 | P1, ready-for-agent | **Queued** | `direct_connection` UNS bypass: designed but not built (0 grep hits) |

### Next likely issues (after #1657 + #1674 merge)
1. **#1662** — `kg_writer` → proposal helper (Phase 3 KG — ADR-0017 — low blast radius)
2. **#1658** — `direct_connection` UNS bypass in `ignition_chat.py` (Phase 6)
3. **#1659** — Citation enforcement + troubleshooting session lifecycle (Phase 7)
4. **#1663** — Hub `/proposals` surface fix (depends on migrations 032-037 on main)

### Action taken this run
- Status sync only: updated `wiki/hot.md`, created `docs/plans/current-state-gap-closure-plan.md`
- CodeGraph sync attempted (best-effort)
- No code changes, no new PRs (at 2-PR limit per routing rules)

---

# Hot Cache — 2026-05-29 — ALPHA

## Session — 2026-05-29 (printing-press toolchain bootstrap + Linear/Stripe CLIs)

Work spanned 2026-05-10 → 2026-05-29; landing now as one continuity entry. Local `main` was 447 commits behind origin when commit happened — reset to origin/main, re-applied this block on top of current hot.md.

- **Installed `mksglu/context-mode` Claude Code plugin** (user scope). Registers `PreToolUse`/`PostToolUse`/`PreCompact`/`SessionStart` hooks + 11 `ctx_*` MCP tools. Intercepts large-output `WebFetch`/`Bash` calls and routes through a sandbox + FTS5 KB. v1.0.111 on disk; v1.0.118+ available.
- **Installed Go 1.26.3** via `brew install go`; added `export PATH="$HOME/go/bin:$PATH"` to `~/.zprofile`.
- **Installed `mvanhorn/cli-printing-press` v4.2.2** generator at `~/go/bin/printing-press`. 9 skills under `~/.claude/skills/printing-press*`. Drives `/printing-press <api>` slash command. MIT.
- **Installed `linear-pp-cli` 1.0.0** via `npx -y @mvanhorn/printing-press install linear`. Local SQLite at `~/.local/share/linear-pp-cli/data.db` — hydrated (290 items in 3.16s: 1 team `CRA` / 2 users / 11 workflow states / 6 labels / 13 projects / 0 cycles / 257 issues). `doctor` green; `me` = `mike @ Cranesync (Admin)`.
- **Installed `stripe-pp-cli` 1.0.0** same orchestrator. Local SQLite at `~/.local/share/stripe-pp-cli/data.db` — NOT hydrated yet (recommend `sync --dry-run` first; event volume could be large). `doctor` 5/5 green via Doppler-injected `STRIPE_SECRET_KEY`; live `balance` call confirmed `meta.source: "live"`.
- **Canonical invocation pattern**: `doppler run --project factorylm --config prd -- <api>-pp-cli <cmd>`. Both CLIs honor `auth_source: env:<KEY>` ahead of file auth — no plaintext on disk.
- **`~/.claude/CLAUDE.md` updated**: dropped the stale "`gh` CLI auth broken" line. Verified `gh 2.87.2` logged in as `Mikecranesync` via keyring (scopes: `gist`, `read:org`, `repo`, `workflow`); auth-required API calls succeed.

**Findings worth flagging:**

- **Linear workspace is at its free-tier issue cap.** Tried to file the session-handoff issue via `linear-pp-cli issues create` and the Anthropic-hosted Linear MCP — both refused: *"Usage limit exceeded — please upgrade or contact sales@linear.app"*. Workspace has 257 issues. Future sessions: don't try to create new Linear issues; comment on existing ones instead.
- **Two `linear-pp-cli` bugs for `/printing-press-retro` filing**: (1) `teams list` always calls GraphQL via GET → Linear rejects as CSRF; `--data-source local` short-circuits before fallback. Workaround: `sqlite3 ~/.local/share/linear-pp-cli/data.db`. (2) `issues create` response parser dies with `decoding graphql response: json: cannot unmarshal string into Go struct field .errors.extensions.userPresentableMessage of type bool` when Linear returns the usage-cap error — the CLI masks the real reason for failure.

**Pointers for continuity:**

- Plan file with full candidate analysis + tier rankings: `~/.claude/plans/polymorphic-hugging-parnas.md`
- Auto-memory: `~/.claude/projects/-Users-factorylm-mira/memory/project_printing_press_toolchain.md`

**Suggested next actions:**

- [ ] Bundle install Tier 1 backlog: `npx -y @mvanhorn/printing-press install openrouter digitalocean` (~90s, both have keys in Doppler).
- [ ] Hydrate Stripe local mirror: `doppler run … -- stripe-pp-cli sync --dry-run` (check scope first).
- [ ] Pick a Tier 3 fresh-print candidate: NeonDB (cleanest OpenAPI), Groq, Telegram Bot API, Atlassian — 30–60 min generation each.
- [ ] Upgrade Linear plan or archive stale issues to unblock future issue creation.
- [ ] File `/printing-press-retro` for the two `linear-pp-cli` bugs above.

---

# Hot Cache — 2026-05-28 — CHARLIE

## eval-fixer run — 2026-05-28
- Scorecard: **35/57 passing (61%)** — `tests/eval/runs/2026-05-28T0300-offline-text.md` (FRESH, nightly eval job is producing scorecards again)
- Action: filed #1576. 22 patchable failures across 3 file clusters — exceeds both single-patch hard limits (>15 failures, >1 file). No autopatch.
- **Major regression: 48/57 → 35/57 (-13 fixtures) since the last fresh scorecard on 2026-05-06.** Three clusters:
  - **A) UNS confirmation gate over-blocking (8 fixtures)** — fixtures stuck at `AWAITING_UNS_CONFIRMATION` when expected to progress to Q1/Q2/DIAGNOSIS. Likely caused by recent UNS-gate work (Namespace Builder Phase 1/2 — PRs #1330/#1332 and follow-ups).
  - **B) VFD documentation-request fixtures landing in diagnostic FSM (7 fixtures)** — `find_manual` / `find_datasheet` intent not routing to IDLE.
  - **C) Question-skip logic too conservative (5 fixtures)** — vendor+model+fault present but engine still asking Q1.
- See #1576 for full triage and suggested remediation order (A → B → C → smaller clusters).
