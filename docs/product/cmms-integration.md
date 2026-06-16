# CMMS Integration

MIRA connects to your CMMS so diagnostic conversations become work orders automatically — no forms, no end-of-shift documentation debt.

> **Status:** Atlas (default) — live. MaintainX, Limble, Fiix — adapter code written; tenant setup flow in development.

## Supported CMMS platforms

| Platform | Status | Notes |
|---|---|---|
| **Atlas CMMS** | Live | Included with FactoryLM. Provisioned automatically at activation. |
| **MaintainX** | Beta | API key required; setup flow shipping soon |
| **Limble** | Beta | API key required; setup flow shipping soon |
| **Fiix** | Beta | API key required; setup flow shipping soon |
| Other (UpKeep, eMaint, etc.) | Roadmap | Contact us if you need a specific adapter |

## What MIRA does with your CMMS

Once connected, MIRA can:

- **List open work orders** for any asset (`"Any open WOs on VFD-07?"`)
- **Pull recent fault history** into every diagnostic ("This asset had a thermal overload 3 weeks ago — same failure mode?")
- **Create new work orders** from a diagnosis (`"Create a WO for this"` → MIRA drafts the title, description, priority, and asset link)
- **Auto-close work orders** when a fault is resolved (you review the draft, tap confirm, done)
- **Pull PM schedules** and flag upcoming maintenance during relevant conversations

## Connecting your CMMS

### Atlas (default — no setup)

Nothing to do. Your Atlas workspace is provisioned at FactoryLM activation. When you log in to MIRA, Atlas is already connected.

### MaintainX / Limble / Fiix

> **Flow shipping soon** — this section will be updated when the self-serve connector is live. For now, email [support@factorylm.com](mailto:support@factorylm.com) to request manual setup.

Generic flow (will work for all three):

1. In your CMMS admin: generate an API key with read/write permissions on work orders, assets, and PM schedules
2. In MIRA admin: **Settings → CMMS → Connect [Platform]**
3. Paste the API key. MIRA validates the connection and lists your assets for confirmation.
4. Click **"Confirm — this is my plant."** Done.

## Safety and data handling

- **Read-only by default.** MIRA only writes to your CMMS when you explicitly approve the draft work order.
- **No bulk sync.** MIRA does not mirror your entire CMMS to its own database; it queries the CMMS API in real time on demand.
- **Per-tenant isolation.** Your CMMS data is not shared with other FactoryLM tenants, ever.
- **Audit log.** Every CMMS write is logged against the MIRA user who approved it.

## Frequently asked questions

**Q: What if I don't have a CMMS?**
A: FactoryLM includes Atlas CMMS with every subscription. It's a full-featured work-order system covering the essentials — work orders, assets, PM schedules, parts inventory. You can start using Atlas at activation and migrate away later if you outgrow it.

**Q: Can MIRA work without any CMMS?**
A: Yes. The chat and diagnostic features work without CMMS. You lose auto-closeout and fault-history grounding, but the core assistant is fully functional.

**Q: What if my CMMS doesn't have a public API?**
A: Most modern CMMS platforms do. If yours doesn't, we can discuss CSV import / email-based work order creation as a fallback. Contact support.

## Where to go next

- [Getting started](getting-started.md) — if you haven't signed up yet
- [QR asset tagging](qr-system.md) — the fastest way to scope MIRA to specific assets
- [Troubleshooting](troubleshooting.md)
