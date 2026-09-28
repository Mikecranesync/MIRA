# Production proof — shared Equipment Notebooks, private technician conversations (v3.320.0 → v3.320.1)

**Date:** 2026-09-06 (UTC) · **Operator:** Claude on CHARLIE, authorized by Mike · **Capability:** `private_notebook_turns` (`docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`)
**Change:** PR #3597 (reviewed head `660b71a72`, merged `3773e2e4e` → **v3.320.0**, rollback `rollback/2026-09-06-v3.320.0`); migration `086_notebook_turn_owner.sql`.

Every step below went through the sanctioned path (`docs/environments.md`): no `psql` against production from a session, no direct VPS docker, migrations and reads via the dispatched workflows.

## 1. Merge at the reviewed content

| Check | Result |
|---|---|
| Independent exact-SHA review | Codex round 6 on `660b71a72` = **PASS** (0 blockers, 0 majors; 1 accepted minor) |
| Branch protection (`strict`) | GitHub refuses a behind branch, so the branch was updated with GitHub's own merge commit twice; **tree identity proven each time**: `git merge-tree --write-tree origin/main 660b71a72` == the new head's tree (`4337568e5…`, then again after #3609). The reviewed commits are ancestors; the delta is byte-identical. |
| CI on the merged head | 41 pass / 1 skip; the two calendar failures (registry `review_by` lapsed) were fixed on main first (#3609) so nothing merged through red |
| Tag | `v3.320.0` at `3773e2e4e` (auto, `version-tag.yml`) |

## 2. Migration 086 on production (human-dispatched workflow)

| Step | Run | Result |
|---|---|---|
| `apply-migrations.yml` target=prod, migrations=086, **dry-run** | 34001325025 | plan = exactly `086_notebook_turn_owner.sql` |
| `apply-migrations.yml` target=prod, **apply** | 34001377472 | apply + post-apply verify steps success; ledger row `086_notebook_turn_owner.sql` at `2026-09-06 00:29:12Z` |
| Auto-deploy triggered by the merge (before 086) | 34001340990 | **failed closed at "Verify prod migration drift = 0"** — nothing deployed ahead of the schema (deploy-order gate working as designed) |

## 3. Schema verified immediately before releasing application code (`db-inspect.yml` prod, read-only probe added in #3608)

| Probe | Value |
|---|---|
| `equipment_notebook_turns.owner_user_id` present, `text`, nullable | **t** |
| `idx_equipment_notebook_turns_owner` present | **t** |
| rows total / ownerless / owned | **211 / 211 / 0** (no backfill; newest row 2026-09-03) |

## 4. Hub release

`deploy-vps.yml` services=mira-hub (run 34002027960): staging gate pass, drift gate pass, deploy success. Live `GET /api/health/` → `version 3.320.1`, `gitSha fb60a0102…` = `origin/main` at that moment, `builtAt 2026-09-06T00:43:50Z`.

## 5. Production smoke (real users on the synthetic tenant; HTTP, no DB)

| Scenario | Result |
|---|---|
| Existing notebook `dd01f71c…` (7 pre-release turns), **grounded** turn as Carlos via `tools/notebook-e2e/notebook_proof.mjs --notebook --doc` | 200 · `answered` · 1 citation (`RCMS460-490_D00067_Q_DEEN.pdf p.2`) · usage recorded (Groq, $0.000532) |
| Same notebook, **zero-source general** turn as Carlos (`mode:"general"`) | 200 · frames `content → sources → evidence → usage → status` · basis `general_reasoning` |
| Persistence owner | `ownerUserId` = Carlos's **session** user id (`…191`) |
| Legacy history | Carlos sees **7 legacy (sharedLegacy) + his own**; Dana (same tenant) sees **7 legacy only** |
| Post-smoke probe | rows **213 / 211 / 2** — the two smoke turns owned, legacy untouched |

## 6. Mobile release + real cross-device proof

| Step | Result |
|---|---|
| `mobile-release-distribute.yml` (first real runs; fixed en route: #3610 secret wiring + APK artifact, #3611 `gradlew` exec bit) | run 34002609290: unit tests, `tsc`, vite build, Capacitor sync, **signed release APK**, `apksigner` verified `CN=FactoryLM` (v2 scheme) |
| Distribution to testers | **not performed** — `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_ANDROID_APP_ID` do not exist in Doppler `factorylm/prd` (or dev). The signed APK is the release artifact (14-day run artifact). **Mike:** provision Firebase, then re-run with `distribute=yes`. |
| **Mobile creates a turn** | The signed release APK installed on an Android 35 emulator (arm64, CHARLIE); signed in as Carlos; opened the existing notebook; asked `Mobile 1788656400: which channels does the RCMS460 monitor…`; cited answer rendered (`[3] RCMS460… p.4`). Screenshots: `docs/promo-screenshots/2026-09-05_notebook-private-turn-mobile-release-apk-*_android.png` |
| **Web reloads the same user's turn** | Real Chrome (Playwright), sign in as Carlos, open the notebook page, reload → the mobile question is on the page. `…web-reload-author-sees-turn_desktop.png` |
| **Second user cannot see it** | Same, as Dana (same tenant) → not on the page. `…web-reload-teammate-does-not_desktop.png` |
| API cross-check | Carlos: 10 turns (7 legacy), mobile turn present, `owner = …191 = self`, `answered`, 1 citation. Dana: 7 turns (7 legacy), mobile turn **ABSENT** |
| Final probe | rows **214 / 211 / 3** (`db-inspect.yml` run 34003165288, 01:10Z) — the 211 legacy rows are untouched; owned = 2 smoke turns + 1 mobile turn |

## What is NOT claimed

- The emulator covers everything except cellular behaviour, real camera capture and Play-installed identity (`tools/mobile-e2e/README.md`); the binary WAS the release-signed APK.
- The Hub does not yet render the persisted identity-dispute marker (#3601, blocked on the HELD `notebook-chat-utils.ts`); two pre-existing parity defects on main are filed (#3606, #3607). All three are queued in `BACKLOG.md` (CU-NB).
