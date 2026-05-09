# Ignition Exchange Listing — MIRA for Perspective

Copy/paste-ready content for the [Ignition Exchange submission form](https://inductiveautomation.com/exchange/submit). Each section maps 1:1 to a field in the Exchange UI.

---

## Resource Name

**MIRA — AI Maintenance Assistant for Perspective**

## Tagline (≤ 100 chars)

Embed an AI maintenance assistant + nameplate scanner in any Perspective project. Free.

## Short Description (≤ 280 chars)

Two drop-in Perspective views that bring AI-powered troubleshooting and nameplate OCR into your plant. Pin the Chat Dock to any page, scan equipment with a phone, and instantly look up manuals, prior work orders, and OEM specs. Powered by FactoryLM.

## Long Description

MIRA brings the kind of AI maintenance assistant your phone gives you for everything else into the place you actually need it — next to your HMI.

This bundle ships two Perspective views that import as one Exchange resource:

**1. MIRA Chat Dock**
A 400-pixel right-side dock that embeds the MIRA chat assistant directly into your project. Operators ask questions in plain English ("why is conveyor 3 alarming?"), MIRA cross-references the live tag context, equipment knowledge base, and a vision-language cascade to answer. Pin it once at the page-config level and it's available on every screen — no extra navigation.

**2. MIRA Scan Widget**
Drop this template into any view to add a one-tap nameplate scanner. The component uses Perspective's built-in mobile camera capture, encodes the photo, and posts to FactoryLM's vision pipeline. Within ~2 seconds the operator sees an extracted **AssetPlate** card with make, model, serial, voltage, and HP. If the asset is already in your FactoryLM knowledge base, the widget opens MIRA chat scoped to that asset. If not, a single-tap "Add to FactoryLM" button kicks off ingestion with the scanned fields prefilled.

**Why it's free:** This is the lightweight, on-Exchange version of MIRA. It calls FactoryLM's hosted backend (no Anthropic key, no model server, no GPU required). Plants that want full per-asset memory, OEM manual ingest, work-order history, and CMMS integration upgrade to the FactoryLM workspace — but everything in this Exchange listing works as-is, forever, at zero cost.

**What's inside:**
- `MIRA/ChatDock` — Perspective view with header bar, embedded Web Browser, and a 10-question soft upsell banner
- `MIRA/ScanWidget` — Camera capture, base64 POST, AssetPlate result card, conditional CTAs
- `MIRA/ScanWidget/components/FieldRow` — reusable label/value row, embedded inside the result card
- Gateway startup script that creates `[default]MIRA/endpoint_url`, `scan_api_url`, and `factorylm_onboard_url` (idempotent — safe to re-run)
- Tag JSON export (alternative install path)
- 5-minute README with setup steps and screenshots

**Endpoints used:** `POST <scan_api_url>/scan/extract` (vision OCR + KB lookup). All URLs are tag-driven, so self-hosters can point at their own MIRA backend.

**Configurable per gateway:** Three Memory tags. No code changes needed.

**Safety:** Arc flash, LOTO, and confined-space queries trigger STOP escalations, never auto-generated procedures. Inference cascades through Groq → Cerebras → Gemini for low latency and zero single-vendor lock-in.

## Category

Primary: **Perspective Resources**
Secondary: **AI / Machine Learning**

## Tags / Keywords

```
perspective, ai, ml, llm, chatbot, maintenance, ocr, computer-vision, nameplate, asset-management, troubleshooting, factory-intelligence, mobile, camera, knowledge-base, free
```

## Feature List (bullet-friendly)

- Drop-in Perspective views — no Java code, no module install required beyond Perspective itself
- AI chat assistant pinnable to any page via Perspective's built-in dock system
- Mobile camera nameplate scanner with sub-2-second OCR (make / model / serial / voltage / HP)
- Per-gateway configuration via three Memory tags — no JSON or code edits to deploy
- Hosted backend at `app.factorylm.com/api/scanbe` — no GPU, no model server, no API keys to provision
- Self-hostable — point the three tags at your own MIRA instance
- Idempotent gateway startup script for clean installs and upgrades
- Built-in safety guardrails — STOP escalation on arc-flash, LOTO, confined-space queries
- Cascade inference (Groq → Cerebras → Gemini) — no single-vendor dependency
- Apache 2.0 licensed, free forever, attribution appreciated but not required
- 10-question soft upsell flow that surfaces the FactoryLM workspace at the moment users see real value, not before

## Compatibility

- **Ignition Version:** 8.1.20+ (uses `ia.display.web-browser` and `ia.input.file-upload`, both stable since 8.1.20)
- **Modules Required:** Perspective
- **Modules Recommended:** None
- **Edge / Maker / Standard:** All editions supported

## Author

**FactoryLM** — Industrial AI for plant maintenance.
[factorylm.com](https://factorylm.com) · [@factorylm](https://twitter.com/factorylm) · [GitHub](https://github.com/Mikecranesync/MIRA)

## License

Apache License 2.0 — included in `LICENSE`.

## Support

Open issues at [github.com/Mikecranesync/MIRA](https://github.com/Mikecranesync/MIRA) under the `ignition-exchange` label, or email `support@factorylm.com`.

## Pricing

**Free** — no Exchange fee, no MIRA subscription, no API key required. Optional FactoryLM workspace upgrade for full multi-asset KB and CMMS integration.

## Screenshots (recommended uploads)

1. `screenshot-chatdock-desktop.png` — Chat Dock pinned right of an HMI page
2. `screenshot-scanwidget-capture.png` — Scan Widget at idle with capture CTA
3. `screenshot-scanwidget-result-matched.png` — AssetPlate card after a KB-matched scan
4. `screenshot-scanwidget-result-unmatched.png` — AssetPlate card with "Add to FactoryLM" CTA
5. `screenshot-chatdock-mobile.png` — Chat Dock on a Perspective mobile session
6. `screenshot-upsell-banner.png` — Soft upsell after 10 questions

## Submission Checklist

- [ ] Replace screenshot placeholders in `assets/` with real captures
- [ ] Bump `version` in `ignition-project/project.json` to `1.0.0`
- [ ] Zip `ignition-project/` as `mira-exchange-1.0.0.zip` for upload
- [ ] Confirm `endpoint_url` and `scan_api_url` defaults still resolve before submission
- [ ] Update FactoryLM marketing site to link to the Exchange listing once approved
