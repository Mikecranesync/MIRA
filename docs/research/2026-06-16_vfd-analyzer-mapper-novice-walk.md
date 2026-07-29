# VFD Analyzer Setup Wizard — Novice Usability Walk + Bug Findings

**Date:** 2026-06-16 · **Branch:** `feat/vfd-analyzer-auto-map` · **Method:** Playwright walk of the
live `testing` sandbox (`http://localhost:8088/data/perspective/client/testing/setup`), driven as a
**first-job, high-school-level novice** trying to map a VFD's tags. Design lens: can a nervous
beginner succeed, without the UI feeling dumbed-down (ISA-101 + first-principles product design).

Screenshots: `novice-walk-0{1..6}-*.png` (repo root, scratch — not promo).

---

## Headline outcomes

1. ✅ **The `a2e52307` cross-page-state fix WORKS** (the resume doc's original blocker). The chosen
   source folder (`[default]MIRA_IOCheck/VFD`) carries Connect → Verify → Map and **backward** too
   (Verify header still shows it after a Back nav). Verify lists the **VFD** tags, not JuiceLine —
   the bug's tell is gone. Persisted via the memory tag `[default]MIRA/Config/_wizard_folder`.

2. 🔴 **P0 (FIXED in source, needs redeploy to confirm live): the mapper cannot save a config on the
   live gateway.** Jython 2.7 `str`/`unicode` trap in the config validator. Root-caused, fixed,
   86 gateway tests + ruff green. See below.

3. Several design findings (P2/P3) that make the *novice* experience harder than it needs to be —
   none block, all are cheap to fix.

---

## 🔴 P0 — Config save is broken on the live gateway (Jython 2.7 unicode/str)

**Symptom (as the novice hit it):**
- *Manual pick* — tapped `vfd_frequency`, preview confirmed "= 0.0 Hz (good)", clicked
  "✓ Use this tag" → **failed** with `ERROR: role vfd/vfd101/freq is missing a non-empty 'tag'`,
  slot stayed "NEEDS A TAG". Reproduced deterministically (not a timing race).
- *Auto path* — "✦ Accept all suggestions" reported "Applied 7 suggestion(s)" **but** the slots stayed
  at "Mapped 0 of 3 required" forever, so "Next: Save" never unlocked.

**Root cause:** `mira_asset_config` (canonical: `ignition/webdev/FactoryLM/api/diagnose/asset_config.py`;
vendored copy: `plc/ignition-project/ConvSimpleLive/ignition/script-python/mira_asset_config/code.py`)
is a **dual Py2.7/3.12** pure module. It validated string fields with `isinstance(x, str)`. Under
**CPython 3.12** (where the regime7 tests run) `json.loads` yields `str` → passes. Under **Jython 2.7**
(the live gateway) `json.loads` and Perspective table-row values are `unicode`, and
`isinstance(u"...", str)` is **False** → every config *read back from the tag* fails validation:
- manual `set_role` gets a `unicode` `selTag` from the Perspective table → rejected on write;
- `accept_all` writes OK (in-memory `str` paths) but `_load`'s read-back (`json.loads` → `unicode`)
  is rejected → returns `None` → slots render unmapped → flow dead-ends.

The tests never caught it because they only exercise CPython 3.12, never the Jython string distinction
— the classic dual-Python gap. The end-to-end *save* path was apparently never walked live before.

**Fix (applied):** a `string_types = (str, unicode)` / `(str,)` compat tuple at module top, used in the
two `isinstance` checks. Collapses to `(str,)` under Py3 → tests unchanged; accepts `unicode` under
Jython → save works. Applied to the canonical file AND synced byte-identical to the vendored copy (the
drift guard `test_script_lib_asset_config_is_byte_identical` enforces this). **86 passed, ruff clean.**

**Still owed:** redeploy to the gateway (`DEPLOY_TESTING.ps1`, elevated) + live re-walk of the manual
pick and Accept-all to confirm slots flip to mapped and Save unlocks.

---

## Design findings (novice lens, ISA-101 + first principles)

### Connect (Step 1)
- ✅ Plain-language hero "Where are this drive's tags?" + clear 1-2-3-4 stepper. Drill-in works; the
  "✓ source: …" confirmation after "Use this folder" is good closure.
- 🟡 **Jargon wall** right after the friendly hero: "Tag provider", "tag", `[default]`, `[+]` — no
  vocabulary a first-day novice has. Add a one-line "what's a tag provider?" hint or default+hide it.
- 🟡 **Two forward actions, two colors** — blue "Use this folder" vs green "Next: Verify" (disabled).
  The dependency (Use unlocks Next) is invisible until you stumble on it. Disabled Next should say why.
- 🟡 **Internal noise:** the `_types_` system folder/row is exposed; a beginner could click it. Filter it.
- 🟡 **No "which folder?" help** — asset is "conveyor" but no folder says conveyor; nothing guides the
  pick among JuiceLine / MIRA / MIRA_IOCheck.

### Verify (Step 2)
- ✅ "Is the source live? … watch the values move" + a live sample = great confidence-builder.
- 🔴→🟡 **Contradictory hidden gate:** the live-sample table is already full of *good* values, yet the
  prompt says "Click Test data source to scan the folder" AND "Next: Map" is disabled. A novice sees
  green data everywhere but can't advance and isn't told why. Either auto-pass when the sample is
  already good, or make the disabled Next state its reason. (After clicking Test, "Found 10 tags — 10
  good, 0 bad" is genuinely reassuring — the friction is only *before* the click.)

### Map (Step 3) — strongest screen, modulo the P0
- ✅ **Matching-game layout is excellent product thinking:** roles as slots (left), only
  datatype-fitting tags (right, "showing number tags (Float / Int)"), active slot highlighted. Kills
  the "wall of irrelevant tags." The live preview "= 0.0 Hz (good)" is the right correctness check.
- 🟡 **"Scale ÷ 100" unexplained** — a novice doesn't know it turns raw 3000 into 30.0 Hz. One-line hint.
- 🟡 **4-color vocabulary** (amber needs / blue active / green advance / purple ✦auto) with nothing
  explaining it.
- 🟡 Optional-signals picker dropdown just says "Select…" — say "Choose an optional signal to add…".
- ⚪ **Unconfirmed:** the candidate **search box did not filter** the list under automated keystrokes
  (value="freq" but all 7 tags still shown, even after blur). Couldn't separate "filter broken" from
  "synthetic typing doesn't reach Perspective's React input" — **needs a human keystroke check.** Low
  priority (datatype pre-filter already narrows to 7).

### Save (Step 4)
- ✅ **On-doctrine messaging:** "Trend + Decode + Anomaly work as soon as you save. Ask MIRA unlocks
  only when this map is approved." + a separate "Approve for Ask MIRA" toggle = train-before-deploy in
  plain words.
- 🔴 **Low-contrast review table** — role names render dark-grey on near-black, barely readable
  (ISA-101 wants values legible). Dim unmapped rows, but above a readable contrast floor.
- 🟡 **Stepper shows false checkmarks when deep-linked** ("3 Map ✓" while "No config yet"). Positional,
  not state-based.
- 🟡 **"Save & Finish" isn't readiness-gated** (only the Map→Save Next button is) — a novice on this
  screen could save an empty map.

### Cross-cutting
- 🔴-pattern **Green monospace status hints** ("NEEDS A TAG -- tap here…", green-on-dark terminal text)
  recur on every screen inside an otherwise clean modern card UI. To a beginner they read as
  code/errors. Make status text match the UI's sans typography + semantic color.
- 🟡 Enterprise table chrome (25-rows pager, page "1") on 7–10 item lists; redundant truncated
  "Full path" column when every tag shares one folder. Trim for the small-list reality.
- ⚪ The "No Connection to Gateway" node in the a11y tree is parked off-screen (`top: -28px`) — Perspective's
  reconnect banner, **not** user-visible. Non-issue.

---

## Recommended priority
1. **Redeploy + confirm the P0 fix live** (manual pick + Accept-all → slots map → Save unlocks).
2. Verify-step hidden-gate + Save-table contrast (the two findings most likely to stall a real novice).
3. Replace the green-monospace status idiom; de-jargon Connect; explain "Scale ÷".
4. Human keystroke check on the Map search filter.
