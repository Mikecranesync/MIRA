# Overnight HANDOFF — NAP-5H release-hardening window (release control)

> Written by the release-control session (`uip267k1@charlie`, "mira-2a-mq") before
> stopping. Mike reads this **first** — before any code, any PR, any peer transcript.
> Built from `docs/templates/overnight-HANDOFF.md`. The root `HANDOFF.md` is untouched.
> Every claim below points at a GitHub comment, run, or SHA; peer messages were
> coordination only and are not cited as evidence.

**Date stopped:** PENDING — window opened 16:19Z (T+00); this draft was written at T+240–T+280 (20:00–20:58Z). Filled in at the real T+300.
**Reason stopped:** PENDING (expected: window ended — **partial**: read-only packets complete; the code carrier never started — see § broken/risky)
**Branch (this doc only):** `docs/nap5h-release-control-handoff` (docs-only, cut from the RC; no code)
**Control plane:** [#3626](https://github.com/Mikecranesync/MIRA/issues/3626) — T+00 `issuecomment-5751026339`, T+120 `issuecomment-5751692332`, T+300 **PENDING** (URL inserted when posted)
**RC (frozen 10:36Z, unchanged all window):** `5eb562feba2c6418c86d5ba82d73c19bdac8e5f5` = `origin/main`
**Production (unchanged all window):** `/api/health/ .gitSha` = `0178b1b0776f30cccde42c8d255031254b882a38` (`recovery-0178b1b07`, built 2026-09-15); last `deploy-vps.yml` run = 35505726834, **failure**, 10:40Z; no dispatch since
**Verdict carried:** **NO-GO retained.** Nothing in this window is cross-surface acceptance.

---

## What was actually done (vs. plan `54600b724`)

| Task | What the plan asked | Status | Evidence |
|---|---|---|---|
| 1 Control plane (T+00–30) | T+00 checkpoint, acknowledged owner map, Codex recorded as reviewer not writer | done | #3626 `issuecomment-5751026339` (T+00); lane table in T+120 `issuecomment-5751692332` |
| 2 Claim + isolate carrier #3910/#3911 (T+30–60) | BRAVO-A claims, isolates at RC | claim only | claim #3626 `issuecomment-5751053713` (16:23Z) + backlinks #3910/#3911 `issuecomment-5751059494/…570`; source correction `issuecomment-5751070748` (16:26Z). **No branch ever reached origin.** |
| 3 Implement exact-source + non-bypass contract (T+60–180) | red-first tests, `approved_rc_sha`, no `origin/main` resolution, mandatory drift, staging receipt | **not started** | carrier PAUSED behind #3893 from 17:01Z; PAUSED checkpoint requested three times, never posted. 17:30Z correction `issuecomment-5751407260` |
| 4 Independent exact-head review (T+180–240) | Codex primary, exact-SHA verdict | no carrier head to review | Codex `um6ts10l` ACKed primary; mira-2b `o2fbkipe` backup; alpha-remote unreachable from ~16:3xZ. Codex did review the *unplanned* #3917 → FAIL (below) |
| 5A staging on separate host (#3909) | read-only prerequisite packet | done (BRAVO-B) | #3626 `issuecomment-5750958022`; #3914 store/OTA entry #3881 `issuecomment-5751280005` |
| 5B rollback dry-run + digest (#3913, #2986) | read-only | done (BRAVO-B) | #3626 `issuecomment-5750958022`; #2986 `issuecomment-5750792608` |
| 5C mobile + cross-surface (#3881, #3882) | read-only packet + evidence sheet | done | release control #3881 `issuecomment-5751081955`, #3882 `issuecomment-5751082777`; mira-2b packet #3881 `issuecomment-5751229855`, `-5751261982` (#3845 delta), #3882 `issuecomment-5751229973`; docs draft PR **#3915** @ `76bb672bf41cd554cd8c6df2b5e8c175b9ad8c1d` (BRAVO-B IR PASS; merge held) |
| 5D STOP persistence spec (#3912) | read-only test spec | done | release control `issuecomment-5751090607`; BRAVO-B contract `issuecomment-5751077614`; mira-2b emulator baseline `issuecomment-5751251645` (component-only, prod `0178b1b07`, **not** RC, **not** acceptance) |
| 5E `/v3` decision packet (#3880) | read-only options | done | release control `issuecomment-5751100987`; BRAVO-B `issuecomment-5751077697` |
| 6 Freeze + wake-up packet | this file + T+300 | **in progress** (draft PR #3918) | this file; T+300 comment PENDING |

**Unplanned lane absorbed:** Mike authorized BRAVO-A in-session to take **#3893** first (claim #3893 `issuecomment-5751270200`, 17:01Z). Draft PR **#3917** @ `122f5041f7b17262ca3d2d09bedb5fb82ff9ad1d` (17:17Z; 10 files, all `mira-mobile/src/**` → guarded, needs `legacy-ui-exception`; PR body carries the section). Codex exact-head **FAIL** `#3917 issuecomment-5751395584` (P1: directive not sticky across truncation/stop on ChatV2). **No remediation push** from 17:23Z through 20:58Z (final range PENDING); Codex 30-min stall notice #3893 `issuecomment-5751541336`. staging-gate PASS at that head (`issuecomment-5751365410`) is not a verdict.

## What I did NOT touch (scope discipline)

- `main`: `5eb562feb…` at open and at 20:58Z (stop value PENDING) — **no merges** (verified by `git rev-parse origin/main` on every 5-min watch tick, logs in session).
- Production: no `deploy-vps.yml` dispatch, no migration apply, no container action, no host command. **Note for the record:** the OVH host Doppler token at `/opt/mira` scope was provisioned by **Mike himself** at ~13:1xZ, *before* plan adoption, via `doppler secrets get OVH_PROD_DEPLOY … | ssh root@… 'doppler configure set token …'`; the token never transited chat. Not a window action.
- Secrets, DNS, OAuth, GitHub environments, branch protection: untouched.
- OTA channels / `updates.factorylm.com` / Play: untouched. Pixel: not attached, untouched. Emulator-5554 used once by mira-2b for a component check, RELEASED 16:58Z (`issuecomment-5751251753`).
- Customer data: none used. Industrial equipment: untouched.
- Labels: none applied. Attestations: none. GO: none.
- `git diff main...HEAD --stat` for this branch: one file, this HANDOFF.

## What's broken / risky (read before merging anything)

1. **The window's one code deliverable did not happen.** #3910 (deterministic deploy, `approved_rc_sha`) and #3911 (mandatory drift gate) are still open with no branch. Until they land, `deploy-vps.yml` still resolves `origin/main` at dispatch time, still honours `skip_drift_check`, and still has `continue-on-error: true` at :477. **Any prod deploy before then is against un-hardened tooling.**
2. **BRAVO-A stalled three times today on critical lanes** (#3876, #3841 reassigned earlier; #3893/#3917 stalled 17:23Z→20:58Z with no ACK; stop value PENDING). Under the sequential mandate I did not reassign. `f7wg2tjp@bravo` is read-only, warm at `5eb562feb`.
3. **Sequencing conflict you must settle** — plan line 106 says the standby "writes only after a recorded handoff" (parallel is permitted); Codex relayed your later heartbeat "BRAVO-A is the only code writer, resume sequentially". I applied the restrictive one (17:30Z). Both are on the card as decision 10.
4. **#3917 review conflict, not just a bug:** Codex requires the energized directive to be *sticky* across truncation/stop; the Hub at `e6f5fbbf8` (#3901) *deliberately drops* `hazardNotice` on truncated/stopped turns (ADR-0038 r6). Whichever wins must be applied to both surfaces or Hub and mobile diverge (mira-2b, #3917 `issuecomment-5751405747`). New P2 **#3916** (shell prints `Trigger: <phrase>` to the technician, `parts.tsx:333`).
5. **Rollback anchor is the running SHA `0178b1b07`, not tag `v3.349.15` (`ad8806dc8`).** Image digest is not exposed by `/api/version` or `/api/health`; needs a read-only host `docker inspect`. Rollback rehearsal **unexecuted** (no non-prod host).
6. **`production` GitHub environment has no protection rules; `ota-*` environments do not exist; OTA/direct-download stores still target dead `165.245.138.91`** → 1.2.1 OTA cannot be staged (#3914). `mobile-release-distribute.yml:566` asserts `known_hosts` has exactly 1 line; the file has 4.
7. **Mobile version regression:** RC `build.gradle` = versionCode 11 / "1.2.0"; the Pixel has vc12 / 1.2.1 installed (from unmerged #3845). An RC APK is a downgrade. #3903 changed native paths → APK-only, never OTA.
8. **#3845 must not be merged wholesale** (39 files, −1557; deletes #3863/#3889/#3890/#3891/#3866/#3903/#3905). Forward delta is three items: R1 vc12/1.2.1 bump, R2 `assertSupportedAttachments` + `questionForAttachments` re-fit to main's `onSend` retry, R3 `pickInBrowser` fallback (#3881 `issuecomment-5751261982`).
9. **Residuals carried from the RC:** `verifyVisualEntry` link-verify DB error still fail-open; `hydrateMessages` → ChatV2 wiring UNVERIFIED on device; staging-gate `oem-model-fault-powerflex-f004` judge flake (#3326, 3 hits today); no deployed staging exists (#3796).
10. **`/v3` "runtime switch":** achievable as env var (`HUB_LANDING_PATH`/`HUB_DEFAULT_SURFACE`, read at request time) + controlled container recreate, **no rebuild**; a true no-restart flag is not feasible in Edge middleware. `/v3` skips `/feed`'s onboarding redirect for fresh tenants. Needs a recreate-only deploy path + `legacy-ui-exception`.

## Open decisions for Mike (plan §8 card — independent decisions, exact targets)

1. **Freeze:** authorize reopening the RC freeze (`5eb562feb`) so reviewed carriers can merge. Nothing is ready to merge tonight; the only candidate heads are #3917 @ `122f5041f` (FAIL) and #3915 @ `76bb672bf` (docs only, IR PASS). *Recommendation:* keep the freeze until a carrier has an exact-head PASS.
2. **Sequence:** staging-first — **resolved** (adopted 16:19Z). No prod deploy of the RC.
3. **Carrier merge:** none authorizable — no exact reviewed PASS SHA exists. (#3915 docs-only may merge on your say-so; it does not change the RC's meaning.)
4. **Staging + approval infra (all yours/infra):** separate staging VPS + non-root staging-deploy key + `STAGING_HOST` variable (#3909; same-host cannot prove §5); DNS `stg.factorylm.com` + `stg-www` (vhost missing); OAuth redirect URIs; Neon staging-branch verify (#2986, needs the stg secret); create `ota-signing`/`canary`/`production` OTA environments and rebuild OTA/direct-download stores on OVH (#3914); **add a `production` environment protection rule naming you as required reviewer** for runs showing the exact approved SHA (#3910 SC1 / #3343 SC14).
5. **`/v3` semantics:** A = env var + controlled recreate (recommended; no image rebuild) vs B = instant no-restart flag (not feasible at the edge). Pick A or state that B is required.
6. **New RC:** not yet — nothing merged. When #3910/#3911 (+ #3917 if you keep it) land with PASS, approve a new exact `approved_rc_sha`.
7. **Later production action:** separately, name the exact new RC SHA. **Precondition:** #3910 + #3911 merged (deterministic deploy + mandatory drift), rollback anchor and digest recorded via read-only host `docker inspect`. Do not infer from any earlier go; #3879 is stood down.
8. **Later device action:** separately authorize a signed build for the named artifact (versionCode must exceed the installed vc12 → needs the R1 bump, `legacy-ui-exception`, signed APK, not OTA) and physical Pixel interaction.
9. **Final customer GO:** only after staging, production, physical mobile, same-thread cross-surface (#3882 sheet, 11 rows), `/v3` cutover + recovery route, and 24 h soak. **Not tonight.**
10. **(New) Writer policy + BRAVO-A:** (a) keep BRAVO-A on both #3893 and the carrier sequentially, or (b) hand the carrier to `f7wg2tjp` (warm, read-only) by a recorded handoff per plan line 106 while BRAVO-A finishes #3917. *Recommendation:* (b) — the file sets are disjoint (`mira-mobile/src/**` vs `.github/workflows/**` + tests) and the carrier is the release blocker.
11. **(New) Safety-directive rule:** sticky-across-truncation (Codex's #3917 reading) **or** drop-on-truncation (Hub's ADR-0038 r6). One rule, both surfaces; the loser gets a follow-up PR (mira-2b volunteered for the Hub side).
12. **(New) #3845 delta:** authorize the 3-item reconstruction on `5eb562feb` as a post-window mobile carrier (proposed owner mira-2b, draft-only until IR). Wholesale merge forbidden.

## Lane return blocks (plan §6 template)

### Release control (`uip267k1@charlie`)
```text
Outcome proven: control plane run T+00→T+280 so far (T+300 PENDING); 5C/5D/5E read-only packets; lane map; this HANDOFF draft. No code.
Issue / criterion: #3626; plan 54600b724 Tasks 1, 5C, 5D, 5E, 6
Primary / backup: uip267k1@charlie / none
Worktree / branch: /Users/charlienode/MIRA-worktrees/nap5h-handoff / docs/nap5h-release-control-handoff (this doc only)
Base SHA / exact tested head: 5eb562feba2c6418c86d5ba82d73c19bdac8e5f5 / n/a (no code)
Files changed or inspected: docs/mira/evidence/nappy-time-2026-09-20/HANDOFF.md (new); inspected .github/workflows/deploy-vps.yml, mira-hub/src/middleware.ts, notebook-chat-utils.ts, NotebookChat.tsx, turns-to-parts.ts, mira-mobile build.gradle (read-only)
Commands, UTC timestamps, exit codes: gh issue/pr view + git fetch/rev-parse every 5 min 16:29Z→20:58Z so far (exit 0; final range PENDING); curl /api/health/ 18:16Z exit 0; no writes except issue comments listed above
PASS / FAIL / NOT TESTED rows: n/a — packets, not tests
Independent verdict and reviewed SHA: n/a
Remaining blocker: carrier #3910/#3911 unstarted
Next action and owner: Mike decides card items 1, 4, 5, 10, 11, 12
Exact approval required: see card
Unauthorized operations confirmation: none — no merge, deploy, migration, secret, DNS/OAuth, OTA, Pixel, label, attestation, GO
```

### BRAVO-A (`iriya7m7@bravo`) — as recorded on GitHub, not returned by the lane
```text
Outcome proven: #3893 draft PR #3917 pushed (mira-mobile 762/762, tsc clean per author) — NOT accepted: Codex exact-head FAIL
Issue / criterion: #3893 (unplanned, Mike in-session); #3910/#3911 carrier (planned) — not started
Primary / backup: iriya7m7 / f7wg2tjp (read-only standby)
Worktree / branch: /Users/bravonode/Mira-worktrees/bravo-3893 / fix/3893-sse-nonterminal-energized; carrier branch nap/5h-hardening-carrier never pushed
Base SHA / exact tested head: 5eb562feb / 122f5041f7b17262ca3d2d09bedb5fb82ff9ad1d
Files changed: 10 under mira-mobile/src/** (guarded → legacy-ui-exception required)
Independent verdict and reviewed SHA: [INDEPENDENT-REVIEW] FAIL @ 122f5041f (#3917 issuecomment-5751395584, Codex)
Remaining blocker: no remediation push since 17:23Z; no PAUSED checkpoint for the carrier; no ACK
Next action and owner: Mike — card item 10
Exact approval required: legacy-ui-exception label (Mike) after a PASS head; merge Mike-gated
Unauthorized operations confirmation: none observed on GitHub
```

### BRAVO-B (`ybn1dstd@bravo`) — DONE, read-only
```text
Outcome proven: 5A (#3909/#3914), 5B (#3913, #2986) prerequisite + rollback packets; 5D test contract; 5E options; digest/rollback-anchor finding; #3915 IR PASS @ 76bb672bf
Evidence: #3626 issuecomment-5750958022; #3881 issuecomment-5751280005; #3912 issuecomment-5751077614; #3880 issuecomment-5751077697; #2986 issuecomment-5750792608
Remaining blocker: all infra items are Mike/infra actions (card item 4)
Unauthorized operations confirmation: none — stood down from #3879 prod deploy at 16:28Z
```

### mira-2b (`o2fbkipe`, device/ADB captain) — DONE, read-only
```text
Outcome proven: 5C packet + Golden Conversation evidence template (docs draft PR #3915 @ 76bb672bf); #3845 delta analysis; #3912 emulator component baseline; #3916 filed; #3917 parity note
Evidence: #3881 issuecomment-5751229855 / -5751261982; #3882 issuecomment-5751229973; #3912 issuecomment-5751251645; #3626 issuecomment-5751231478 / -5751251753; #3917 issuecomment-5751405747
PASS / FAIL / NOT TESTED: physical acceptance NOT TESTED (Pixel not attached, no RC artifact); emulator component-only
Remaining blocker: no approved_rc_sha; mobile workflows current-main-coupled; OTA stores on dead host
Unauthorized operations confirmation: none — Pixel untouched, emulator RELEASED
```

### Codex (`um6ts10l`, plan owner + primary reviewer) — read-only
```text
Outcome proven: exact-head FAIL on #3917 @ 122f5041f; 10-minute watch; stall notices
Evidence: #3917 issuecomment-5751395584; #3893 issuecomment-5751541336; #3626 issuecomment-5751400123
Remaining blocker: no carrier head to review
```

### alpha-remote (`qdyer0ey@alpha`) — unreachable from ~16:3xZ; no window output. f7wg2tjp — read-only standby, no output.

## Reproduce the state

```bash
git fetch origin && git rev-parse origin/main            # 5eb562feba2c6418c86d5ba82d73c19bdac8e5f5
curl -s https://app.factorylm.com/api/health/ | jq .gitSha  # 0178b1b0776f30cccde42c8d255031254b882a38
gh run list --workflow deploy-vps.yml --limit 1          # 35505726834 failure 10:40Z
gh pr view 3917 --json headRefOid,isDraft                # 122f5041f…, draft
gh pr view 3915 --json headRefOid,isDraft                # 76bb672bf…, draft, docs only
gh issue view 3626 --comments | grep -n 'NAPPY-TIME'     # T+00 / T+120 / T+300
git ls-remote --heads origin | grep -E 'harden.*carrier|3910|3911'   # (empty — carrier never pushed)
```

## Suggested morning checklist (Mike)

- [ ] Read this top to bottom, then the T+300 comment on #3626 (PENDING until posted).
- [ ] Confirm the untouched list yourself: `origin/main`, prod `.gitSha`, `gh api repos/Mikecranesync/MIRA/environments`, Pixel.
- [ ] Decide card items 10 → 1 → 4 → 5 (writer policy first; it unblocks the carrier).
- [ ] If keeping #3917: settle item 11 before BRAVO-A remediates, or the fix will be reviewed against the wrong rule.
- [ ] Do **not** dispatch `deploy-vps.yml` until #3910 + #3911 are merged and a new `approved_rc_sha` is frozen.
- [ ] Only then: reopen the freeze, merge the exact reviewed SHA(s), re-freeze.
