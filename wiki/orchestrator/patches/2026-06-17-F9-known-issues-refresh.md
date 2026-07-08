# F9 staged fix — refresh `docs/known-issues.md` (the orphaned beta-blocker ledger)

**Why:** `docs/known-issues.md` (Updated 2026-05-26, 56 lines) has **zero** mention of the
beta gate, upload→retrieval, #1592, #2077, or the North Star — `grep -ni 'beta|upload.*retriev|1592|2077|stranger|cited'` returns 0 hits. The doc whose entire job is tracking
beta blockers omits the single most important beta arc. Meanwhile `docs/CHANGELOG.md` is
current to today (v3.27.8), so this is one orphaned doc, not systemic rot.

**Scope:** docs-only. Outside `wiki/orchestrator/`, so the orchestrator does NOT edit it in
place — a code session applies this. No code, no schema, no CI.

## Edits to make in `docs/known-issues.md`

1. Bump the header: `Updated: 2026-06-17`.

2. Add a **top stanza** (above "Known Broken / Incomplete"):

   ```
   ## Beta Gate (North Star) — status

   - **Gate:** a stranger uploads their own equipment manual, asks a real
     troubleshooting question, and gets a grounded, cited answer — zero manual fixing.
   - **Status (2026-06-17): PASSING on deploy truth.** xfail removed (#2077);
     `tests/beta/beta_ready_upload_retrieval_citation.py` is now a real assertion,
     CI-enforced by `beta-gate.yml` (weekly Mon 07:00 UTC + gate-path PRs) against a
     real stranger provisioned on staging Neon. Upload→retrieval gap (#1592) closed.
   ```

3. **Narrow #736** (deploy-by-tag) in the "Known Broken" list — append:
   `Partially mitigated by #1970: version-gate.yml auto-bumps /VERSION every code PR and
   version-tag.yml auto-creates v<VERSION> + rollback/<date> on every merge. Remaining
   half: deploy-vps.yml still checks out main HEAD, not the tag.`

4. **Add** to "Resolved (kept for context)" the round-7/8/9 closures the doc omits:
   #1833 (tenant IDOR / cross-tenant leak), #1899/#1903/#1909/#1919 (gate-adjacent),
   #1901 (onboarding upload→ask beta close), #2020 (staging usable),
   #2077 (beta gate CI-enforced), #2082 (hub-e2e wired).

5. **Add** one open low-watch item: `cp_citation_vendor_relevance (#1858) — vendor-strip
   diagnostic invariant has no operable PR-time CI guard until the keyless replay store is
   recorded (D4 runbook). Founder-keyed, not stranger-reachable.`

## Verify after applying

```bash
cd <repo>
grep -ni 'beta gate\|upload.*retriev\|#2077\|North Star' docs/known-issues.md   # now >0 hits
grep -n 'Updated: 2026-06-17' docs/known-issues.md                              # header bumped
```

Commit: `docs(known-issues): refresh beta-gate arc + round 7-9 closures, narrow #736`
