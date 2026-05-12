# monday.com Marketplace Listing — MIRA Scan

> Source-of-truth copy for the Monday Developer Center submission form.
> Edit here, then paste into the listing form. Pre-submission review
> goes through `security-audit.md` and `privacy.md` first.

## App name

**MIRA Scan**

## Tagline (subtitle)

Stop typing nameplates. Snap them.

## Short description (≤150 chars — used in marketplace tiles)

Snap a nameplate photo. MIRA's AI extracts make, model, serial, voltage, HP, RPM — straight into your monday.com item.

(149 chars)

## Long description

**The problem.** Every maintenance team has the same Tuesday-afternoon problem: a tech adds a new pump to a board, and the next 8 minutes evaporate squinting at a grimy nameplate, typing "GA500" three times because autocorrect keeps changing it, then copy-pasting voltage and HP from the same plate. Multiply by 200 assets a year. That's a week.

**The fix.** Open the MIRA Scan panel on any monday.com item. Tap **Scan plate**. Phone camera opens. Snap once. MIRA's vision model reads the nameplate and writes make, model, serial, voltage, HP, RPM, and frame size directly into the columns you've already configured.

**What you also get.**
- **Grounded chat with the manual.** When MIRA recognizes the equipment, the panel turns into a Q&A on the OEM manual — cited answers, not hallucinated paragraphs. Ask "what does fault F004 mean on this drive?" and get the page from Yaskawa's actual GA500 manual.
- **Missing manuals get found.** When MIRA doesn't have the manual yet, it searches the open web in real time, validates that the result is a real OEM PDF (we deny SEO spam by host), and queues it for ingest. Next scan of the same equipment returns the cited answer.
- **No second app.** MIRA Scan lives inside monday.com. Your data stays in the columns you already work with. No re-entry, no re-export.

**How it works (3 steps).**
1. **Scan.** Tap the camera icon. The panel calls our vision pipeline (GPT-4o Vision) and returns structured fields with a confidence score.
2. **Review.** Edit anything that looks off. The panel renders an `AssetCard` you can fix in place.
3. **Save.** Click **Save to monday item**. The fields land in your board columns via Monday's GraphQL API.

**Who it's for.** Maintenance planners, reliability engineers, and operations teams running asset registries on monday.com. Especially useful if your boards have voltage, HP, RPM, or other electrical/mechanical spec columns that currently get filled by hand.

**Pricing.** Free during beta. Once we see meaningful install volume we'll add a free tier with a soft cap (50 scans / month) and a paid tier through monday.com's marketplace billing. Existing installs grandfather into the free cap.

**Already running.** MIRA Scan is live at `app.factorylm.com/scan/` (standalone web app, no monday.com required). The same backend powers the marketplace integration — every endpoint is verified end-to-end against real Beckhoff, Siemens, and Allen-Bradley nameplates.

## Feature bullets (3-5 for the listing card)

1. **Snap a nameplate, get structured fields.** GPT-4o Vision extracts make, model, serial, voltage, HP, RPM, frame.
2. **Grounded chat with the OEM manual.** Cited answers from the actual manufacturer doc, not generic AI summaries.
3. **Missing manuals get found automatically.** Real-time web search with OEM-host preference and SEO-spam blocklist.
4. **Writes straight back to your monday.com columns.** Per-board column mapping; no re-entry.
5. **Privacy-respecting.** No end-user PII captured. Image and equipment data only.

## Support contact

- **Email:** support@factorylm.com
- **Response SLA:** within 24 hours (business days)
- **Known issues:** [`/support/known-limits.md`](./support/known-limits.md)

## Categories / tags (suggestions)

- Operations
- Manufacturing
- Maintenance
- AI / Automation
- Field service

## Permissions requested (must match the app's OAuth scope)

- `me:read` — identify the installing user and account
- `boards:read` — read the asset board structure (column ids, item ids)
- `boards:write` — write extracted specs back to item columns

## Pricing model declaration (Developer Center field)

- Free (during beta)
- Roadmap: free tier + paid tier via Monday marketplace billing post-launch

## Listing assets checklist

- [ ] App icon — 512×512 PNG, transparent background
- [ ] Banner image — 1920×1080 PNG (use a clean phone-on-bench shot)
- [ ] 5 screenshots at 1280×800 — see `screenshots/SHOTLIST.md`
- [ ] 90-second demo video — see `demo-script.md`, host on YouTube unlisted
- [ ] Privacy policy URL — link to `privacy.md` once published at `https://factorylm.com/scan/privacy`
- [ ] Terms of service URL — link to FactoryLM standard terms at `https://factorylm.com/terms`
