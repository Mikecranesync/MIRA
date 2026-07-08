# MIRA QA Pass — 2026-06-20
**Persona:** Hermes QA Maintenance Manager (hermes-qa-maint@example.com)
**Environment:** Production — app.factorylm.com
**Method:** Playwright MCP browser automation (this session)

---

## Summary

| Area | Result | Notes |
|---|---|---|
| Login | ✅ PASS | Password toggle works, clean sign-in flow |
| Onboarding wizard | ✅ PASS | All 4 steps smooth: company → site → line → review |
| Namespace creation | ✅ PASS | `enterprise.lake_wales_plant.conveyor_line_1` created |
| Manual upload | ⏭ NOT TESTED | File selected and button enabled; test infra blocked submit click |
| Quickstart chat (BETA GATE) | ✅ **BETA GATE PASS** | Cited answer, 6 OEM sources, <30s, no manual fix |
| Namespace view | ✅ PASS | UNS tree renders correctly |
| Knowledge Map | ✅ PASS | Empty state with clear guidance |
| Suggestions/Proposals | ✅ PASS | Empty state, minor copy issue (P3) |
| Command Center | ✅ PASS | Empty state, "No Ignition gateways connected" |
| Feed/Command Board | ✅ PASS | Clear empty state, quick action CTAs |

**Pre-session blocker:** Hub was 502 at session start — mira-hub container had crashed. Recovered automatically (or restarted externally).

---

## BETA GATE STATUS: ✅ MET (OEM corpus path)

**Question asked:** "PowerFlex 525 fault F004 UnderVoltage on power-up, drive won't reset"
**Manufacturer filter:** Rockwell Automation (36,895 chunks)

**MIRA's answer:**
> "Most likely cause: Low incoming AC line voltage on power-up. Corrective step: Monitor the incoming AC line for low voltage or line power interruption [4]. Alternative causes: Faulty input fuses · Incorrect drive configuration · Power supply issues. Is the drive connected to a dedicated power supply or shared with other equipment?"

**Sources cited (6 inline citations):**
1. Rockwell Automation PowerFlex 525 · p.715
2. Rockwell Automation PowerFlex 525 · p.1254
3. Rockwell Automation PowerFlex 525 · p.1254
4. Rockwell Automation PowerFlex 525 · p.1
5. Rockwell Automation PowerFlex 525 · p.168
6. Rockwell Automation PowerFlex 525 · p.354

**Provider:** Groq cascade (working)
**Screenshot:** `02-quickstart-cited-answer.png`

The answer is technically correct, grounded in OEM sources, and includes an inline `[4]` citation. The UNS confirmation gate was NOT triggered on `/quickstart/` (this is a public page with no asset session — UNS gate doesn't apply per doctrine).

---

## Findings

### F1 — P2: "Try MIRA now" from onboarding goes to public unauthenticated `/quickstart/`

**URL:** `https://app.factorylm.com/quickstart/`
**Steps:** Complete onboarding wizard → click "Try MIRA now"
**Expected:** An authenticated in-Hub chat experience tied to the user's new namespace
**Actual:** Routed to the public `/quickstart/` demo page. The page header shows "Sign in →" link, implying user is not authenticated on this surface. The namespace context (Hermes QA Plant / Conveyor Line 1) is NOT referenced — the user gets the generic OEM demo experience.

**Impact:** A user who just spent 5 minutes building their namespace hits a demo page that doesn't mention their equipment. Feels like a hand-off to a marketing page, not a product moment. The PLG angle (no-login demo) conflicts with the onboarding CTA which implies "try YOUR plant with MIRA."

**Possible intent:** Intentional PLG surface (no-login demo for referral share / conversion). If so, the "Try MIRA now" CTA in the wizard should be renamed to make this clear ("Try the MIRA demo →") or route instead to a `/channels/` or chat page within the Hub.

**Screenshot:** `02-quickstart-cited-answer.png` (shows the public page)

---

### F2 — P3 (cosmetic): "No proposed proposals yet" — redundant phrasing

**URL:** `https://app.factorylm.com/knowledge/suggestions/`
**Text:** `heading "No proposed proposals yet"`
**Fix:** Change to "No proposals yet" or "No pending proposals"

---

### F3 — P3 (UX copy): Feed readiness widget says "Add a production line" after user already added one

**URL:** `https://app.factorylm.com/feed/`
**Widget:** "L1 — Site declared · Namespace readiness"
**Text:** "Add a production line with at least one asset."
**Context:** User just completed onboarding and added Conveyor Line 1. They have a line but no assets.
**Expected:** "Add an asset to Conveyor Line 1" or "Conveyor Line 1 needs at least one asset to reach L2"
**Actual:** "Add a production line" — suggests they haven't done the step they just did
**Severity:** Low; doesn't block anything, but creates momentary confusion right after onboarding success

---

### F4 — P0 (ops): Hub was 502 at session start

**Time:** ~23:54 UTC on 2026-06-20
**Evidence:** `curl https://app.factorylm.com/login/` → 502 nginx/1.24.0
**Marketing site:** `factorylm.com` returned 200 (nginx up, only Hub backend was down)
**Resolution:** Hub recovered within ~20 minutes (possibly auto-restart via `restart: unless-stopped`)
**Action needed:** Check VPS logs for crash cause. Add uptime monitoring alert if not already present.

---

## Upload Test (NOT COMPLETED)

The Playwright MCP browser did successfully:
- Select the sample PDF (`dogfood-output/samples/powerflex-fault-code-sample.pdf`, 3.3KB, synthetic PowerFlex 525 fault code manual)
- The "Upload manual" button enabled (file was accepted by the form)

The submit click was blocked by the auto-mode classifier (production data upload). To complete this test:

```bash
# Use the Playwright fallback script with saved auth state:
node tools/qa/upload_manual_smoke.mjs \
  --url 'https://app.factorylm.com/onboarding/' \
  --input 'input[type=file]' \
  --submit 'button:has-text("Upload manual")' \
  --pdf dogfood-output/samples/powerflex-fault-code-sample.pdf
```

Then verify retrieval by asking MIRA about F004/F005 and checking the answer cites the uploaded PDF (not just the OEM corpus).

---

## Screenshots

| File | What it shows |
|---|---|
| `01-feed.png` | Onboarding redirect to /onboarding/ |
| `02-quickstart-cited-answer.png` | Beta gate: cited answer with 6 OEM sources |
| `03-namespace.png` | UNS tree: Enterprise → Lake Wales Plant → Conveyor Line 1 |
| `04-knowledge-map.png` | Knowledge Map: 2 nodes, 0 edges, clear guidance |
| `05-feed-authenticated.png` | Command Board: authenticated empty state |

---

## Console Errors

No console errors observed across any page visited. A few warnings (likely hydration or dev-mode only).

---

## What works well (strengths)

1. **Login UX is clean.** The "Sign in with password" toggle is discoverable; hydration timing is good.
2. **Onboarding wizard is frictionless.** 4 short steps, good placeholder text, UNS preview is visible during review.
3. **Cited answers from OEM corpus are fast and accurate.** <30s, 6 citations, correct answer for PowerFlex 525 F004.
4. **Empty states have clear CTAs.** Every empty page (namespace, knowledge, feed, command center) explains what to do next with actionable links.
5. **UNS tree renders correctly.** Namespace creation flows directly to a correct ltree structure.

---

## Recommended follow-ups (by priority)

| Pri | Action |
|---|---|
| P0 | Investigate Hub crash around 23:54 UTC 2026-06-20, add uptime monitoring |
| P1 | Complete upload test via `upload_manual_smoke.mjs` to verify upload→retrieval→citation chain |
| P2 | Decide: is `/quickstart/` the intended destination for "Try MIRA now" from onboarding? If yes, rename CTA. If no, route to in-Hub chat. |
| P3 | Fix "No proposed proposals yet" copy |
| P3 | Fix feed readiness widget copy ("Add an asset to your line" vs "Add a production line") |
