# Vendor KB Coverage — v1 Demo Ship-Blocker #3

**Date:** 2026-04-15  
**Executed from:** CHARLIE (192.168.1.12) — VPS unreachable during this run (see note below)  
**Tenant:** 78917b56-f85f-43bb-9a08-1bb98a6cd6c3 (shared OEM pool)  
**KB total entries pre-run:** 61,644  
**KB total entries post-run:** ~61,680 (+16 Mitsubishi, +7 Pilz/Danfoss/Omron partial)  
**Embedding host:** Charlie localhost:11434 / Bravo LAN fallback — `nomic-embed-text:latest`

---

## ⚠️ VPS Note

`factorylm-prod` (165.245.138.91) was **unreachable** throughout this run — both SSH and
HTTPS timed out. The containerized ingest service (`mira-ingest :8002`) was not available.
All scrapes were triggered directly from CHARLIE via the Apify API.

**Mike: check DigitalOcean console — the VPS needs attention.**

---

## Coverage Matrix

| Vendor | Models tested | Pre-coverage | Post-coverage | Outcome | Notes |
|--------|--------------|--------------|---------------|---------|-------|
| AutomationDirect | GS20, GS10, GS1 | 1,440 | 1,440 | ✓ READY | 3 models indexed; GS20 demo target confirmed |
| Allen-Bradley | PowerFlex 753, PF525 | 1,311 | 1,311 | ✓ READY | PowerFlex 753 model indexed; 1,311 substantive chunks |
| Siemens | SINAMICS G120, G120C | 202 | 202 | ✓ READY | 202 chunks attributed to Siemens; vector search only (model_number blank) |
| Schneider Electric | Altivar ATV312, ATV71 | 246 | 246 | ✓ READY | 246 substantive chunks |
| Mitsubishi Electric | FR-E800, FR-A800 | 0 | 16 | ⚠ THIN | 16 chunks from product overview pages. No fault codes or parameter tables yet. |
| ABB | ACS310, ACS355, ACS580 | 24 | 24 | ⚠ THIN | 24 generic VFD reference chunks — no model_number set, no fault codes. |
| Yaskawa | V1000, A1000, GA500 | 16 | 16 | ⚠ THIN | 16 chunks from Traverse software supplement only. No V1000 fault codes. |
| Pilz | PNOZ X3, PNOZ X4, PSEN 1.1 | 0 | 2 | ✗ MANUAL_INGEST_NEEDED | SPA-rendered site; Apify gets shell only. 2 partial chunks from DDG fallback. |
| Danfoss | VLT FC302, FC301 | 0 | 2 | ✗ MANUAL_INGEST_NEEDED | SPA-rendered; 2 DDG-sourced chunks. Needs PDF upload. |
| Omron | MX2, CJ1M, CP1E | 0 | 3 | ✗ MANUAL_INGEST_NEEDED | Primary crawl returned 0 items; 3 DDG-sourced chunks. Needs PDF upload. |

---

## Summary

| Vendor | Status | Demo risk |
|--------|--------|-----------|
| AutomationDirect | ✓ READY | None |
| Allen-Bradley | ✓ READY | None |
| Siemens | ✓ READY | Low — vector search works, no model indexing |
| Schneider Electric | ✓ READY | None |
| Mitsubishi Electric | ⚠ THIN | Medium — general FR series questions OK, fault code lookup will miss |
| ABB | ⚠ THIN | Medium — generic VFD content only, no ACS-specific fault/param answers |
| Yaskawa | ⚠ THIN | High — V1000 fault code queries will get no KB hit |
| Pilz | ✗ MANUAL_INGEST_NEEDED | **Demo-blocking** |
| Danfoss | ✗ MANUAL_INGEST_NEEDED | **Demo-blocking** |
| Omron | ✗ MANUAL_INGEST_NEEDED | **Demo-blocking** |

**3 demo-blocking gaps.** 3 more vendors are technically ≥5 chunks but thin on fault/parameter content.

---

## Action Items for Mike

### Priority 1 — Manual PDF uploads (3 vendors fully blocked)

Send each PDF directly to the MIRA Telegram bot — it routes automatically to
`mira-ingest /ingest/document-kb`.

Alternatively, once VPS SSH is restored:
```bash
curl -X POST http://localhost:8002/ingest/document-kb \
  -F "file=@/path/to/manual.pdf" \
  -F "manufacturer=<vendor>" \
  -F "model_number=<model>"
```

---

#### Pilz — PNOZ X safety relays

**Official download page:** https://www.pilz.com/en-US/support/downloads  
Filter: Product family → PNOZ X → document type → Operating Manual

Grab:
- PNOZ X3 Operating Manual
- PNOZ X4 Operating Manual
- PSEN 1.1 Safety Switch Operating Manual

---

#### Danfoss — VLT FC302

**Official download page:** https://www.danfoss.com/en/service-and-support/downloads/dds/vlt-drives/  
Filter: Product → VLT AutomationDrive FC 302

Grab:
- Operating Instructions (doc no. MG33AX02)
- Programming Guide (doc no. MG33MX02)

Try direct: https://files.danfoss.com/download/Drives/MG33MK02.pdf

---

#### Omron — MX2 VFD + CJ1M PLC

**Official download page:** https://www.ia.omron.com/support/  
Search: 3G3MX2 User's Manual (I570)

Grab:
- 3G3MX2 Inverter User's Manual (I570-E1-08 or latest)
- CJ1M CPU Unit Hardware User's Manual (W393)

EU mirror to try: https://assets.omron.eu/downloads/manual/en/v9/i570_mx2_inverter_users_manual_en.pdf

---

### Priority 2 — Thin vendor improvement (Mitsubishi, Yaskawa, ABB)

These pass the ≥5 threshold but will underperform on fault code / parameter queries.

| Vendor | What to grab | Where |
|--------|-------------|-------|
| Mitsubishi | FR-E720 Instruction Manual (IB0600348) | https://www.mitsubishielectric.com/fa/products/drv/inv/ → Downloads |
| Yaskawa | V1000 Technical Manual (TOBPC71061900) | https://www.yaskawa.com/products/drives/ac-micro-drives/v1000 → Documents |
| ABB | ACS310 User Manual (3AUA0000044201) | https://new.abb.com/drives/low-voltage-ac-drives/acs310 → Downloads |

---

### VPS-side scrape-trigger commands (run once VPS is back)

```bash
# Pilz
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"Pilz PNOZ X3","manufacturer":"Pilz","model":"PNOZ X3","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'

# Danfoss
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"Danfoss VLT FC302","manufacturer":"Danfoss","model":"VLT FC302","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'

# Omron
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"Omron MX2","manufacturer":"Omron","model":"MX2","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'

# Yaskawa
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"Yaskawa V1000","manufacturer":"Yaskawa","model":"V1000","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'

# Mitsubishi
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"Mitsubishi FR-E720","manufacturer":"Mitsubishi Electric","model":"FR-E720","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'

# ABB
curl -X POST http://localhost:8002/ingest/scrape-trigger \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"ABB ACS310","manufacturer":"ABB","model":"ACS310","tenant_id":"78917b56-f85f-43bb-9a08-1bb98a6cd6c3"}'
```

---

## Methodology

1. Queried NeonDB directly from CHARLIE:
   `manufacturer ILIKE '%vendor%' AND LENGTH(content) > 500 AND tenant_id = '<shared>'`

2. Pass-1: Triggered `apify~website-content-crawler` via REST API (fixed URL: `~` not `/`).
   Vendor doc pages, `playwright:chrome`, maxCrawlPages=30, maxCrawlDepth=2.

3. Pass-2: Targeted product pages + DuckDuckGo HTML search fallback for vendors still below threshold.

4. Chunked at 400–5,000 chars. Embedded via `nomic-embed-text:latest` on localhost:11434.

5. Inserted to NeonDB with `manufacturer`, `model_number`, `source_url` fields.

**Root cause of SPA failures:** Pilz, Danfoss, Omron, Yaskawa, ABB all use JS-rendered product sites.
Playwright depth=2 captures the shell only — manual content is behind dynamic loaders, login walls,
or iframes. Direct PDF ingest is the only reliable path for these vendors.

---

## Apify Run IDs (audit trail)

| Vendor | Run ID | Pass | Result |
|--------|--------|------|--------|
| Pilz | 6Zd7UhrjaEGRqSANK | 1/primary | LOW_QUALITY — 1 page, 943 avg chars, 0 written |
| Pilz | InzpXF6x6WG9iCPGd | 2/primary | LOW_QUALITY — 1 page, 1 written |
| Pilz | 4sfloRdMJhExGoYsJ | 2/ddg | 2 items — 1 written |
| Mitsubishi | tAuMxmn51BTmPtyxO | 1/primary | LOW_QUALITY — 30 pages, 2207 avg, 16 written ✓ |
| Omron | VlhhJr6RodzTF9Ud3 | 1/primary | EMPTY |
| Omron | IP93k5exeekVrjmTA | 2/primary | 1 item, 1 written |
| Omron | LbmWFJPkNJytAQga0 | 2/ddg | 2 items, 2 written |
| Danfoss | Ear6VbboY0rddMqFy | 1/primary | LOW_QUALITY — 1 page, 518 avg, 0 written |
| Danfoss | HVEqhRz3olyi0dZxh | 2/primary | LOW_QUALITY — 1 page, 0 written |
| Danfoss | rmGEWKFXHi1L0wjiU | 2/ddg | 2 items, 2 written |
| Yaskawa | cLso4MHtSiJECUjlZ | 1/primary | LOW_QUALITY — 1 page, 159 avg, 0 written |
| Yaskawa | bwN8ZMqRCdD6KWQFz | 2/primary | LOW_QUALITY — 1 page, 0 written |
| ABB | YVdMfJRs6JrLP26sa | 1/primary | LOW_QUALITY — 1 page, 337 avg, 0 written |
| ABB | T8Lwfwu24QUb3uECT | 2/primary | LOW_QUALITY — 1 page, 0 written |
