# Pack truth audit (#2777) — PowerFlex 525, PowerFlex 40, DURApulse GS10

Source-pinned verification of every remaining Drive Commander pack against hash-pinned primary
manuals, per issue #2777. Method identical to the G120 audit
(`2026-07-17-drive-commander-printsense-deslop-closeout.md`): deterministic scripts over the PDF
text layer — each identifier AND its name must be located in the manual (page-exact where the
pack cites a page), plus negative sweeps. **No entry was filled from memory or inference.**

## Verdict

**Zero fabrications found in any pack.** All three packs pass identifier-by-identifier
verification. (Contrast: the G120 pack from #2621 failed on essentially every entry.)

## Primary sources (hash-pinned; recorded in each pack's `provenance.verification`)

| Pack | Manual | Publication / edition | SHA-256 |
|---|---|---|---|
| powerflex_525 | PowerFlex 520-Series User Manual | `520-UM001O-EN-E` (Sept 2025), 274 pp | `b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6` |
| powerflex_40 | PowerFlex 40 User Manual | `22B-UM001J-EN-E` (Sept 2025), 156 pp | `15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9` |
| durapulse_gs10 | DURApulse GS10 User Manual (chapter PDFs) | 1st Ed. Rev B — ch6 (troubleshooting, 44 pp) + ch4 (parameters, 236 pp) | ch6 `df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669` · ch4 `d68a0a4da9ab37544c21b5a362bedae85671812ccc8df92e66f909ad2fecb0dd` |

Sources: `literature.rockwellautomation.com` (both Rockwell) · `cdn.automationdirect.com` (GS10;
the single-file `gs10m.pdf` URL serves HTML — the chapter PDFs are the canonical artifacts).

## Truth table — pack by pack

### PowerFlex 525 (mira-web + pack of record in mira-bots)

| Check | Result |
|---|---|
| 48 fault names vs manual | **48/48 found** — spot verbatim: F004 "UnderVoltage — DC bus voltage fell below the min value" (fault table p.161), F005 "OverVoltage", F007 "Motor Overload" |
| 45 parameter id+name on cited page | **45/45 PAGE-OK** (whitespace/case-normalized: the manual line-wraps names, e.g. "Average kWh \nCost") |
| Edition drift | none — pack page citations match the Sept-2025 edition O pagination |
| Downgrades required | none. One cosmetic variance recorded: pack "Reset To Defaults" vs manual "Reset to Defaults" (case only, supported) |
| Negative sweep | F999/F200/F055 absent from the manual's F-number token set and unsupported by the pack |

### PowerFlex 40 (mira-web + pack of record in mira-bots)

| Check | Result |
|---|---|
| 26 fault names vs manual | **26/26 found** — spot verbatim (Table 10, p.93): F4 "UnderVoltage", F5 "OverVoltage", F12 "HW OverCurrent" |
| 9 parameter id+name on cited page | **9/9 PAGE-OK** |
| Notes | manual displays F4/F5/F12; pack keys are bare ints rendered F004-style by the display layer — same identifiers |
| Negative sweep | F999/F200/F055 absent + unsupported |

### DURApulse GS10 (mira-bots only — not on the web surface)

| Check | Result |
|---|---|
| 9 real fault-record ids | **9/9** — numeric id verified adjacent to its mnemonic in ch6 (4=GFF ground fault, 12=Lvd, 21=oL, 49=EF, 54–58=CE1/CE2/CE3/CE4/CE10). id `0` = synthetic "no active fault" zero-state (no manual row expected; documented) |
| 8 parameters vs ch4 | **8/8 ids verified**; 6/8 exact names on cited chapter pages; P01.01/P01.02 near-verbatim vs the ch4 register table ("Motor 1 Fbase", "Motor 1, Rated Voltage (Nameplate)") — supported |
| bench_verified items | status_bits / cmd_word / registers / envelope.dc_bus are **bench-tier** provenance (physical GS10, `rules_core.py` + commit `a882605a`) — stronger than manual_cited; intentionally not downgraded |
| Fault-name form | normalized short forms of the manual's mnemonics — meanings verified, not verbatim sentences (recorded in the verification block) |

## Corrections / downgrades applied

**None required by the sources.** The only pack edits are additive `provenance.verification`
blocks (manual identity + URL + SHA-256 + result + notes), applied at the **packs of record**
(`mira-bots/shared/drive_packs/packs/*/pack.json`) and re-vendored into mira-web via
`bun run scripts/vendor-drive-packs.mjs` (byte-for-byte, per the vendor law).

## Unsupported/honest behavior (verified)

- mira-web: unknown fault → 404 + `noindex` + "We don't have X in this pack" (live-verified for
  F30006 in the G120 close-out; covered by `renderFaultNotFound` tests + new negative pins).
- mira-bots: the drive-pack ask path answers "not documented, here's what is covered" for
  ids outside the pack (existing no-guess contract, CHANGELOG v3.1xx) — no LLM invention.

## New regression fixtures (truth pins)

- `mira-web/src/lib/__tests__/drive-commander.test.ts` →
  `describe("powerflex packs — manual-verified truth pins (#2777)")` — 4 tests: PF525 fault
  meanings, PF40 fault meanings, audited shape + hash-pinned verification block, negative pins.
- `mira-bots/tests/test_drive_pack_truth_pins.py` — 5 tests: GS10 fault-record ids, GS10
  never-real ids, GS10 parameters, PowerFlex fault pins, all-packs hash-pinned verification.
- **A pin caught a from-memory error during authoring:** the first negative-pin draft used
  F100 as a "never-real" code — F100 is a REAL PF525 fault ("Parameter Chksum"). Negatives are
  now sourced from a regex sweep of the manuals' F-number tokens, never from memory. Left in
  the test comment as a worked warning.

## CI enforcement (`mira-web pack tests` job)

- **Finding:** the FULL mira-web bun suite is **provably non-deterministic** today — three
  consecutive full runs produced three different failing-test sets (hashes `805917faa182`,
  `a3c59a047411`, `843faf8d259a`). Causes: cross-file `process.env` mutation without restore
  (≥8 test files assign env at module/beforeAll scope) + env-dependent files (`qr-tracker`
  throws at import without `NEON_DATABASE_URL`; `knowledge-seed` needs a live DB). Individually,
  `account-deletion` (7/7), `activation` (8/8), `inbox` (27/27) pass — they fail only under
  cross-file pollution.
- Per the gate ("required only after proving deterministic, reasonably fast, green on main"),
  the full suite does NOT qualify. The new `mira-web-pack-tests` job runs the **deterministic
  subset** — `drive-commander.test.ts` + `printsense-landing.test.ts` + `components.test.ts` —
  proven **3× identical: 70 pass / 0 fail, ~20 ms** (now 74 with the new pins). This covers
  exactly the incident class that motivated the requirement (a syntactically broken
  `drive-commander.test.ts` merged to main unexecuted → hotfix #2775).
- **Required-check flip (post-merge, deliberately not self-service in this PR):** after this PR
  merges and the job has a green run on main:
  `gh api -X PATCH repos/Mikecranesync/MIRA/branches/main/protection/required_status_checks -f 'contexts[]=staging-gate' -f 'contexts[]=Version Bump Check' -f 'contexts[]=Hub E2E (command-center + onboarding)' -f 'contexts[]=mira-web pack tests'`
- Full-suite determinism (fixing the env pollution across ~8 unrelated test files) is
  **out of scope** here per the no-mixing rule — tracked as a #2777 follow-on note.

## Test evidence

| Command | Result |
|---|---|
| `bun test src/lib/__tests__/drive-commander.test.ts` | **37 pass / 0 fail** (incl. 4 new PowerFlex pin tests) |
| `bun test drive-commander + printsense-landing + components` ×3 | identical: 70 pass / 0 fail (pre-pins), ~20 ms |
| `pytest tests/test_drive_pack_truth_pins.py` (mira-bots, repo .venv) | **5 passed** |
| `pytest tests/test_drive_packs.py + schema_v2 + readonly + gs10_v2_fixture` | **43 passed** (loader tolerates the new verification key) |
| `actionlint .github/workflows/ci.yml` | clean |

## Process notes

- The GS10 manual-fetch subagent reported a successful download whose file was 932 bytes of
  HTML on disk — re-downloaded directly and hash-matched its claimed ch6 SHA. Subagent outputs
  verified against disk, per the standing verify-subagent-output rule.
- Audit executed in an isolated worktree off main `4409686741ab` (post-#2780); no foreign WIP
  touched.
