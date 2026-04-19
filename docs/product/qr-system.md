# QR Asset Tagging

> **Status:** In development (spec locked, implementation sprint starting 2026-04-20)
> **Full spec:** [docs/superpowers/specs/2026-04-19-mira-qr-system-design.md](../superpowers/specs/2026-04-19-mira-qr-system-design.md)

## What this is

A printed QR sticker on each piece of plant equipment. Scan with your phone → MIRA opens pre-scoped to that machine. No typing, no asset lookup, no "let me explain what I'm looking at."

## Why it matters

Stage 1 of every diagnostic conversation is "what machine are we talking about?" Without QR entry, this is ~30 seconds of typing per conversation. With QR, it's one second.

For a 10-technician plant doing 50 diagnostics per week, that's ~4 hours of technician time saved per week — before MIRA even starts answering questions.

## How it will work (MVP, shipping within 1 sprint)

### For the plant manager (one-time setup)

1. Open MIRA admin → **QR Stickers → Print**
2. See a list of every asset in your CMMS
3. Check the boxes next to the assets you want to tag
4. Click **"Generate sticker sheet (PDF)"**
5. Print the PDF on Avery 5520 weatherproof vinyl (any office supply store, ~$22/pack)
6. Peel and stick near each machine's nameplate
7. **Verify each sticker by scanning it with your phone.** MIRA shows a green ✓ if the scan resolves to the right asset.

### For the technician (every day after)

1. Walk up to a machine
2. Open phone camera, point at the sticker
3. Tap the link that appears
4. MIRA chat opens with: *"What's the symptom on VFD-07? I have it as a Yaskawa GS20, last serviced February 14th."*
5. Respond by voice or text. Diagnostic conversation proceeds.

## What ships in v1 vs. later

### ✅ In v1 (first release)

- `/m/{asset_tag}` URL shape — human-readable, works from any QR reader
- Admin print page with batch PDF generation on Avery 5520 layout
- Per-asset scan tracking (count, first scan, last scan)
- Pipeline seeding — chat opens with asset context baked in
- Pre-login handling: scans redirect to login, then complete to the chat

### 🔜 v2 or later

- NFC tap alternative for the same URL
- Signed tokens / QR rotation (for sticker-swap security concerns)
- Portable Bluetooth label printers (tag-and-print in one pass)
- "Asset owns the thread" — persistent chat threads tied to the asset, visible across shifts
- Analytics dashboard — "which assets are getting scanned the most"

## Sticker recommendations

| Environment | Material | Cost / label | Expected life |
|---|---|---|---|
| Indoor clean (food, pharma, electronics) | Avery 5520 weatherproof vinyl | ~$0.20 | 1–2 years |
| Indoor heavy industrial (machining, welding, foundry) | Laminated vinyl | ~$0.35 | 2–3 years |
| Outdoor / harsh (pump stations, wastewater, outdoor conveyors) | Anodized aluminum | ~$2.00 | 5+ years, essentially permanent |

FactoryLM will ship the first 50 stickers **free on industrial laminated vinyl** for design-partner customers during beta. Self-service PDF printing is free for all customers.

## Frequently asked questions

**Q: What if a sticker falls off or gets damaged?**
A: Reprint from the admin page. The QR URL is permanent — the replacement sticker points to the same asset.

**Q: What if an asset is decommissioned?**
A: The sticker still scans, but the admin page lets you mark the asset as retired. MIRA will tell scanners: "This asset has been retired. Contact your admin if this is unexpected."

**Q: Can I use these across multiple plants?**
A: Each sticker is scoped to your tenant (plant). If a contractor from another MIRA customer scans your sticker, they see a polite "this asset belongs to another plant" message — no data leaks.

**Q: What about NFC?**
A: Planned for v2. Same URL format; you'll be able to pair an NFC tag with each asset alongside the QR sticker for gloved / low-light environments.

## Where to go next

- [Getting started](getting-started.md) — if you haven't signed up yet
- [CMMS integration](cmms-integration.md) — QR scans auto-populate CMMS fields
- [Troubleshooting](troubleshooting.md) — scan issues and fixes

---

*Detailed engineering spec (including architecture, acceptance criteria, security model, and pre-implementation decisions): [docs/superpowers/specs/2026-04-19-mira-qr-system-design.md](../superpowers/specs/2026-04-19-mira-qr-system-design.md)*
