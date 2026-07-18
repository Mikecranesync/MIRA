# Close-out — Drive Commander / PrintSense de-slop + G120 truth correction (2026-07-17)

**Sequence:** design-token de-slop of the public Drive Commander surface, correction of the
fabricated Siemens G120 pack, checkout-success state, PrintSense landing rebuild — merged,
deployed, and independently verified end-to-end.

## 1. Merge ladder (chronological)

| # | PR | What | Merged (UTC) | Squash-merge SHA |
|---|----|------|--------------|------------------|
| 1 | #2773 | G120 pack rebuilt from the real Siemens List Manual | 2026-07-17 23:02:06 | `054a296a98cb` |
| 2 | #2772 | `--fl-dark-*` tokens + Drive Commander de-slop + `?checkout=` states + CLAUDE.md Anthropic carve-out | 2026-07-17 23:33:12 | `0e1b641ee69f` |
| 3 | #2775 | Hotfix: test-block closers dropped by the #2772 conflict resolution | 2026-07-17 23:44:46 | `586925b79af3` |
| 4 | #2776 | G120 `p0100` name → manual-verbatim "IEC/NEMA mot stds" | 2026-07-17 23:48:16 | `03c6bad505b0` |
| 5 | #2774 | PrintSense landing — showcase structure on tokens, honest claims kept | 2026-07-17 23:56:18 | `7f48fdc0214e` |

**Final main:** `7f48fdc0214e` · **Final VERSION:** `3.158.0` · **Deploy:** deploy-vps.yml run `29621990086 (2026-07-17 23:57:36 UTC, success; prior deploys 29621040112/29621651941 carried #2772/#2773/#2775/#2776)` (auto: push → smoke → deploy)

## 2. Primary source (hash-pinned)

- **Document:** List Manual G120C — “SINAMICS G120C List Manual (LH13), 04/2014”
- **Siemens order number:** `A5E33840768B AA` · 570 pages
- **Downloaded from:** `https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf`
- **SHA-256:** `82aad5dd75b1923230ef163f03fcaa730362d6948bf97bab483c13526bcda268`
- Recorded in-pack at `mira-web/src/data/drive-packs/siemens_g120.json → provenance.verification`.
- Note: the G120**C** List Manual is the publicly retrievable G120-family fault/parameter
  reference; the F30xxx power-unit faults and these p-numbers are SINAMICS-family-wide. Every
  rendered citation names this document exactly.

## 3. What was wrong (the fabricated #2621 pack, live ~6 days)

Every fault meaning shifted or invented; five fault codes (F30006–F30010) and five parameters
(p0104, p0105, p0293, p0644, p0645) do not exist in the manual at all; all 18 parameters cited
one page ("413") of a document id ("0319_en-US") matching no Siemens numbering. A technician
reading F30002 got the opposite of the manual (said undervoltage; real: overvoltage).

## 4. Verified truth (independent re-verification, code+name located on each cited printed page)

**8 faults:** F07011 Motor overtemperature (p.498) · F30001 Power unit: Overcurrent (p.522) ·
F30002 Power unit: DC link voltage overvoltage (p.523) · F30003 Power unit: DC link voltage
undervoltage (p.524) · F30004 Power unit: Overtemperature heat sink AC inverter (p.524) ·
F30005 Power unit: Overload I2t (p.524) · F30011 Power unit: Line phase failure in main
circuit (p.525) · F30012 Power unit: Temperature sensor heat sink wire breakage (p.525)

**20 parameters:** p0100 IEC/NEMA mot stds (p.44) · p0210 Drive unit line supply voltage (p.48) ·
p0292 Power unit temperature alarm threshold (p.51) · p0300 Motor type selection (p.52) ·
p0304 Rated motor voltage (p.53) · p0305 Rated motor current (p.53) · p0307 Rated motor power
(p.54) · p0310 Rated motor frequency (p.55) · p0605 Mot_temp_mod 1/2 threshold (p.70) ·
p0610 Motor overtemperature response (p.70) · p0640 Current limit (p.74) · p1000 Speed setpoint
selection (p.106) · p1001 Fixed speed setpoint 1 (p.107) · p1121 Ramp-function generator
ramp-down time (p.124) · p1200 Flying restart operating mode (p.129) · p1201 Flying restart
enable signal source (p.130) · p1800 Pulse frequency setpoint (p.165) · p2000 Reference speed
reference frequency (p.173) · p2010 Comm IF baud rate (p.176) · p2011 Comm IF address (p.176)

Verification method: deterministic script over the PDF text layer — for each entry, the code/id
AND the verbatim name must appear on the cited printed page. Result **28/28 OK** (27/28 before
#2776; the single flag was p0100's paraphrased long name — corrected to verbatim).
Negative checks: F30006–F30010 absent from the entire manual and from the pack; the five
fabricated parameter ids absent from the pack. `purpose` fields left empty by policy (the PDF
text layer interleaves adjacent parameter descriptions — never invent).

**Truth pins:** `mira-web/src/lib/__tests__/drive-commander.test.ts` →
`describe("siemens g120 pack — manual-verified truth pins")` (5 tests: shifted meanings stay
dead; fabricated codes/params stay gone; citations must name the List Manual and never
"0319_en-US"; ≥6 distinct cited pages; fault→param links only where the manual's remedy names
the parameter). De-slop pins: `describe("de-slop invariants")` (7 tests: no emoji, single fault
list, no "All N fault codes" overclaim, tokens linked / no stray hex, checkout states).

## 5. Repository-wide stale-mapping sweep (all remaining hits legitimate)

- `0319_en-US`: only in (a) the append-only promo-screenshot manifest
  `docs/promo-screenshots/2026-07-11_drive-commander-g120-freemium_MANIFEST.md` (historical
  archive of the *old* page), (b) the pack's own correction note, (c) the truth-pin assertion
  that citations never contain it.
- "F30001 … overvoltage": only the historical manifest + the truth-pin comment describing the bug.
- "F30002 … undervoltage": zero hits.
- F30006–F30010 / p0104 / p0105 / p0293 / p0644 / p0645: only the correction note, the negative
  truth pins, and the historical CHANGELOG entry from #2621 (see Risks).
- Benchmark corpus (`mira-bots/benchmarks/corpus/`): no fabricated G120C mappings; the one
  SINAMICS hit is a real S120 field report where F30003 = undervoltage — consistent with the
  corrected pack. KB seeds / bots drive packs contain no Siemens pack.
- No LLM fallback path serves G120 codes: the public pages render only vendored pack data, and
  an unknown code returns the honest 404/noindex "We don't have X in this pack" placeholder
  (verified live for F30006).

## 6. Test evidence (final branch content, post-#2774-rebase)

| Command | Result |
|---|---|
| `bun test src/lib/__tests__/drive-commander.test.ts` | **33 pass / 0 fail** (incl. 5 truth pins + 7 de-slop invariants) |
| `bun test src/__tests__/printsense-landing.test.ts` | **4 pass / 0 fail** |
| `bun test` (full mira-web, 32 files) | **341 pass / 16 fail / 7 errors — fail set byte-identical to clean origin/main** |

Inherited (not caused by this stack; identical on clean main via stash-baseline comparison):
`account-deletion`, `qr-tracker`, `activation`, `inbox`, `knowledge-seed` tests — all require
live env (NEON_DATABASE_URL, JWT secret, real Stripe/Resend keys) absent in local runs.
mira-web defines no separate lint/build script (bun-native TS); repo pre-commit hooks
(shellcheck / rg secrets / actionlint) passed on every commit.

## 7. Live verification (factorylm.com, after deploy)

| Check | Result |
|---|---|
| `/drive-commander/siemens-g120` | honest count "8 … faults in this pack · 5 with cited troubleshooting detail"; single fault list; real manual in provenance chip; no emoji; `/_tokens.css` linked |
| `/faults/F30001` | title "… F30001 — Power unit: Overcurrent" |
| `/faults/F30002` | title "… F30002 — Power unit: DC link voltage overvoltage" |
| `/parameters/p0304` | title "… p0304 — Rated motor voltage" |
| `/faults/F30006` (fabricated) | **HTTP 404**, `noindex`, "We don't have “F30006” in this pack." — truthful unsupported, no invention |
| `?checkout=success` | "Payment confirmed" banner rendered; "Unlock Drive Commander Pro" CTA absent |
| `?checkout=cancelled` | "Checkout cancelled — no charge was made." quiet note; Pro CTA still present |
| plain visit | no banner; Pro CTA present (correct default) |
| `/printsense` | HTTP 200; F004=UnderVoltage sample present; IMPORT HELD + STOP &middot; ESCALATE states render; "does not replace engineering review", "human reviewer", "synthetic material" all present; invented stats ("68,000", "confident misreads", "MOST POPULAR") absent; no emoji; tokens linked |
| `POST /printsense/interest` (synthetic lead) | invalid email → HTTP 400 + "Please use a valid work email" (honest visible failure); synthetic lead `deslop-closeout-test@factorylm.com` → HTTP 200 + success message; backend receipt verified read-only on the VPS: row in `/data/printsense-leads/leads.jsonl` and content-free `package_request_submitted` event in `funnel.jsonl` (no email in analytics). Test lead is synthetic — safe to delete. |

No real charge was performed; checkout states verified via the Stripe return URLs
(`mira-web/src/lib/stripe.ts` success_url/cancel_url).

## 8. Screenshots (append-only archive, committed with #2774)

`docs/promo-screenshots/2026-07-17_drive-commander-g120-deslopped-{before,after}_{desktop,mobile}.png` ·
`…_drive-commander-g120-checkout-success_{desktop,mobile}.png` ·
`…_printsense-merged-{before,after}_{desktop,mobile}.png`
Fresh post-deploy live captures (this commit): `2026-07-17_live-g120-final_{desktop,mobile}.png`, `2026-07-17_live-g120-checkout-success_desktop.png`, `2026-07-17_live-f30001_desktop.png`, `2026-07-17_live-f30006-notfound_desktop.png`, `2026-07-17_live-printsense-final_{desktop,mobile}.png`.

## 9. Incidents during the sequence (honest record)

1. **Broken test file reached main.** The #2772 rebase conflict resolution dropped the closing
   `});\n});` of the truth-pins block; the branch was pushed before the suite was re-run, and
   the PR merged because **no required check executes the mira-web bun suite**. Fixed forward
   within 11 minutes (#2775, 33/33 verified pre-push). CI-coverage gap folded into #2777.
2. **One paraphrase survived the first correction** (p0100 long-form name not in the manual) —
   caught by the independent re-verification pass, fixed in #2776.

## 10. Risks / unresolved

- `docs/CHANGELOG.md` (entry from #2621, ~line 384) still repeats the fabricated
  "F30006 inverter overtemp … all grounded" claim as historical text — superseded by this
  document and by the CHANGELOG entry added with it; historical entries are not rewritten.
- Fault display renders `F7011` (data-layer 3-digit padding) vs Siemens' canonical `F07011` —
  cosmetic renderer nit, noted in #2773.
- The cited manual is the G120C List Manual; if a CU240-family G120 List Manual is later
  acquired, citations can be re-pinned 1:1 (meanings are family-wide).
- Other packs (PowerFlex 525/40, GS10) spot-checked only — full source-pinned audit is #2777.
- mira-web bun suite still not a required PR check (also #2777).

## 11. Follow-up

- **#2777** — source-pinned truth audit for every Drive Commander pack + pack promotion gate +
  mira-web-suite-as-required-check.
