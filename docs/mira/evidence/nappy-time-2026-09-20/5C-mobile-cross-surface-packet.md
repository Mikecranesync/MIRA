# NAP-5H lane 5C — mobile / cross-surface readiness packet (#3881 + #3882)

**Plan:** `docs/superpowers/plans/2026-09-20-five-hour-release-hardening-execution.md` (commit `54600b724`), Task 5C.
**Owner:** `o2fbkipe` (`mira-2b`, device captain, CHARLIE). **Mode:** READ-ONLY. Nothing below was built, signed,
installed, published, or dispatched. Physical-device acceptance is **NOT TESTED** in this packet.
**Refreshed at:** 2026-09-20 16:50 UTC against `origin/main` `5eb562feba2c6418c86d5ba82d73c19bdac8e5f5` (tag `v3.349.16`).

## 1. Starting truth (refresh before acting)

| Fact | Verified state | Release meaning |
|---|---|---|
| `origin/main` | `5eb562feb` | Frozen RC source per the plan; every mobile job below couples to *dispatch-time current main*, not to an approved SHA |
| Production | `/api/health/` `gitSha=0178b1b07` (16:50Z) | Prod does not carry #3874 (photo grounding) or any Hub L0 work → the photo step of the Golden Conversation cannot pass against prod until #3878/#3879 |
| Physical Pixel 9a `55081JEBF07026` | **not attached** to CHARLIE adb at 14:20Z and 16:50Z; last known (03:31Z) stock FactoryLM `1.2.1` / `versionCode 12` = PR #3845 head `93dddf10f`, apk sha256 `f1b047a59614968ce39cea3acc1f4738132c00a5f02bce17166cf5850d498efc`, signer `2395b960…f92a9`, not debuggable | The phone is AHEAD of `main` on version metadata (below); it must be re-attached before any #3881 action |
| Emulator `emulator-5554` (AVD `mira35`) | #3903 **debug** build, `1.2.0` / `versionCode 11`, debug keystore, signed in as the e2e account | Component evidence only — never acceptance |
| Signed RC APK | **does not exist** | Only pre-RC debuggable builds were made overnight (main `e7d339ed7` `4dfc0efd…`, main `f4ef32cad`+#3898+#3899 `e3b58d04…`); none is the RC |
| Pre-read evidence | `docs/proofs/2026-09-20-pixel9a-pre-rc-main-e7d339ed7-golden-conversation-preread.md` (PR #3897) | Component evidence: steps 1/2/3/5 PASS, 4 blocked on prod, 6–8 PASS on the **legacy** Hub notebook page, not `/v3` |

## 2. `approved_rc_sha` binding gap — mobile jobs (the plan's correction 1 applied to mobile)

Both mobile release workflows bind to **`github.sha` at dispatch** and then **require that SHA to equal live `main`**; neither
accepts an approved SHA input, so an approved *older* RC cannot be built once `main` moves, and a newer `main` is always what
gets built. This is the same defect the plan names for `deploy-vps.yml`.

| Workflow | Source binding today | Current-main coupling | Approved-SHA input | Publication target |
|---|---|---|---|---|
| `.github/workflows/mobile-release-distribute.yml` (`Mobile release — build + distribute`) | `actions/checkout ref: ${{ github.sha }}` in `verify-mobile`, `build-unsigned-native`, and the governed-metadata job (L49–51, L74–76, L525–527); provenance/`latest.json` `commit` = `RELEASE_SHA = github.sha` (L541, L591–594) | `Require the exact current main source` runs **three times** (sign job L244–252, distribute job L459–467, publish job L608–616): `gh api …/git/ref/heads/main` must equal `GITHUB_SHA` or the job errors `refusing a stale main mobile release` | **none** — inputs are `release_notes`, `groups`, `distribute`, `publish_download` (L12–33) | direct download: `scp`/`ssh` to `root@165.245.138.91` (L640–653) with `ssh-keygen -F 165.245.138.91` host-key pin (L567) — **the dead DigitalOcean host** |
| `.github/workflows/ota-release.yml` (`OTA release — publish canary / promote proven handset build`) | `checkout ref: ${{ github.sha }}` (L84) | `git rev-parse refs/remotes/origin/main` must equal `GITHUB_SHA` or `refusing a stale main workflow run` (L91–92) | **partial:** `apk_base_sha` ("exact commit of the installed Play APK") and `evidence_commit_sha` (promote) bind the *bundle* to an APK commit and a receipt commit — but the workflow's own source is still dispatch-time main | `OTA_HOST: 165.245.138.91` (L61), store root `/srv/factorylm/ota` (L471, L486), via `ota-canary` / `ota-production` / `ota-signing` **GitHub environments that do not exist** (repo environments at 16:50Z: `production`, `staging` only) |

**Consequence for #3881:** as written, a "1.2.1 RC" build from CI is *whatever `main` is when someone clicks dispatch*. There
is no machine binding between Mike's approval, the RC SHA, and the APK. The Doppler-signed build's `latest.json.commit`
honestly records the built SHA, but nothing checks it against an approved one.

**Proposed extension (design only — for the #3910/#3911 carrier owner or a follow-up carrier; NOT implemented here):**

1. Add `approved_rc_sha` (required, `^[0-9a-f]{40}$`, must exist in the repo) to `mobile-release-distribute.yml` and
   `ota-release.yml`; check out **that** SHA in every job; replace the three/one "current main" checks with
   `GITHUB_SHA == approved_rc_sha` **and** `approved_rc_sha` is an ancestor of `main` (so an approved older RC is buildable
   and a non-main commit is not).
2. Stamp `approved_rc_sha` into the provenance artifact and `latest.json` (`commit` already exists — keep it equal to
   `approved_rc_sha` and assert), and into the OTA receipt (`evidence/docs/release/evidence/ota/<sha256>.json`).
3. Bind the OTA bundle's `apk_base_sha` to the same `approved_rc_sha` when the bundle is cut from the RC.
4. Gate `distribute=yes` / `publish_download=yes` / OTA `promote` behind a **protected environment whose required reviewer
   is Mike** (the plan's authenticated human gate, item 3 of Task 3). Today `environment: production` has no protection
   rules, and the `ota-*` environments do not exist, so this remains **externally BLOCKED** on GitHub configuration.
5. Local reconstruction (what the device captain does for #3881 when authorized): build from the frozen SHA in a detached
   worktree and record `git rev-parse HEAD` == `approved_rc_sha` in the identity table below — the manual equivalent of (1)
   until CI carries it.

## 3. Version metadata — exact source state

| Where | `versionName` | `versionCode` | Note |
|---|---|---|---|
| `origin/main` `5eb562feb` `mira-mobile/android/app/build.gradle` L37–38 | `1.2.0` | `11` | The RC source is **behind the phone** |
| PR #3845 head `93dddf10f` (draft, CONFLICTING; the stock build on the phone) | `1.2.1` | `12` | The only place `12/1.2.1` exists; #3845 is to be **reconstructed** on the frozen RC, not merged wholesale (director rule) |
| Phone (last known) | `1.2.1` | `12` | `adb install -r` of any main-based build needs `versionCode ≥ 12` (a vc11 build is refused as a downgrade on a release build) |
| Emulator | `1.2.0` | `11` | debug; `install -r -d` was used overnight |
| Policy | `docs/release/android/README.md` L15–16: `versionCode` +1 on **every Play upload**, never reused | The next *Play* upload must be `12` only if `12` was never uploaded to Play; if the 09-18 sideload was never a Play upload, `12` is still free for Play — **verify in Play Console before cutting** (not visible from the repo) |

The governed-metadata job reads `versionName`/`versionCode` **from the checked-out `build.gradle`** (L556–557) and writes
them into `latest.json` — so the version bump must be a **commit on the RC SHA**, not a worktree-local edit, for CI-built
artifacts. That bump is a native-fingerprint change (as is #3903, already on main) → **APK release, never OTA**.

## 4. Stale publication host — what is actually live

| Reference | State at 16:50Z |
|---|---|
| `mobile-release-distribute.yml` publish target `root@165.245.138.91` + pinned host key | DigitalOcean host is **dead** (#3800); the publish job would fail at `ssh-keygen -F`/connect |
| `ota-release.yml` `OTA_HOST: 165.245.138.91`, store `/srv/factorylm/ota` | same dead host |
| `updates.factorylm.com` DNS | resolves to **`40.160.141.61` (OVH)** |
| `https://updates.factorylm.com/download/latest.json`, `/download/`, `/ota/`, `/ota/production/manifest.json`, `/ota/canary/manifest.json` | **all `404`** from `nginx/1.24.0` on OVH — the download + OTA stores were **not migrated**; the vhost serves nothing |
| GitHub environments referenced (`ota-signing`, `ota-canary`, `ota-production`) | **absent**; only `production`, `staging` exist |
| Last successful runs | mobile-release `34857574240` (2026-09-14, `1d20ab5e6`); ota-release `34131104475` (2026-09-07, `5cd26f33a`) — both pre-cutover, both against the DO host |

**Consequences:**
- The installed app's OTA "Check now" hits a 404 manifest today; per the 09-19 acceptance note the UI reports "Up to date"
  on a non-observable failure (LIMITED finding) — a 404 is indistinguishable from "current" to the technician.
  **There is no working OTA or direct-download path for 1.2.1 until the stores are rebuilt on OVH** (or a new host) and the
  workflows are retargeted (BRAVO-B's 5A packet, carriers #3910/#3911 per BRAVO-B's roster note; `ota-release.yml` and
  `mobile-release-distribute.yml` are in the ~11 workflows still naming the dead IP).
- Therefore **#3881's realistic delivery for the physical Pixel is a locally built, Doppler-signed APK sideloaded by the
  device captain** (the recipe in memory/handoff), with OTA "staged, not published" being *impossible* rather than merely
  unauthorized until the host work lands. Firebase distribution (`distribute=yes`) is independent of the dead host but
  still current-main-coupled and unprotected.

## 5. Cross-surface (#3882) binding facts

- Hub `/api/health/` reports `gitSha`; `mira-web` does not (plan correction 2). The phone talks to `https://app.factorylm.com`
  (`mira-mobile/src/api/client.ts` `API_BASE`, hardcoded) — the cross-surface proof therefore binds **phone APK SHA** +
  **Hub `gitSha`** and cannot bind `mira-web` until it exposes source identity.
- The pre-read proved persistence phone → legacy Hub notebook page (`/equipment/<id>/`) → phone (turn
  `534a980c-518c-4aa3-92ea-752bd9277383` appeared once). **`/v3` was not exercisable on prod `0178b1b07`** (old prototype
  page); #3882 steps 6–8 on the shared shell wait for the #3879 deploy.
- Known open defect that will show on the RC walk after the deploy: **#3900** (uncited answer badged "Grounded in this
  notebook's sources." — basis derived from request scope). It is not a client defect; the evidence sheet has a row for it.

## 6. Golden Conversation evidence sheet

Template: `golden-conversation-evidence-template.md` (same directory). It carries the identity block (source SHA, APK
sha256, signer, versionCode/Name, tenant type, Project ID, thread ID, evidence/file IDs, citation targets, timestamps) and
PASS / FAIL / NOT TESTED rows for photo-first, text-first, upload failure + retry, evidence association, grounded answer,
close/reopen safety state, simultaneous phone/web sends, and phone → web → phone continuity, plus the RC-only rows the
ledger split requires. Every row starts as `NOT TESTED`.

## 7. Exact approvals / blockers for #3881 + #3882 (no hidden actions)

| # | Needed | Owner | Approval |
|---|---|---|---|
| 1 | Frozen `approved_rc_sha` named by the release director after Mike's freeze decision (main moved past `cf06e7bf7` to `5eb562feb`; #3888 closed 10:31Z) | `uip267k1` / Mike | Mike (decision card item 6) |
| 2 | Version bump commit (`12` / `1.2.1`, or `13` if `12` was consumed on Play) **on the RC SHA** — reconstructing #3845's delta | sole implementer or device captain via a claimed PR | Mike (merge → reopens freeze, decision card items 1 + 3) |
| 3 | Signed build + physical Pixel interaction for the named artifact | device captain (`o2fbkipe`) | Mike (decision card item 8) — **separate** from any earlier go |
| 4 | Prod carrying #3874 for the photo step and `/v3` for steps 6–8 | BRAVO-B (#3878 apply, #3879 deploy) | Mike (items 4/7) |
| 5 | OTA/direct-download stores rebuilt on the live host + workflows retargeted + `ota-*`/protected environments created | 5A carrier (#3909/#3910/#3911) | Mike (item 4) — until then OTA cannot even be staged |
| 6 | Pixel physically re-attached to CHARLIE | Mike | — |

## 8. Unauthorized operations confirmation

No build, signing, install, uninstall, reset, OTA publish, distribution, workflow dispatch, secret read, or device
interaction was performed for this packet. Commands run were `git show`/`git log`/`gh run list`/`gh api …/environments`
(read-only), `curl -sI`/`dig` against public hosts, and `adb devices` (list only).
