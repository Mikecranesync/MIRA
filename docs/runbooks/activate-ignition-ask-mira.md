# Runbook: Activate "Ask MIRA" (Ignition cloud-chat)

**Updated:** 2026-06-07
**Goal:** Get the Perspective **"Ask MIRA"** button answering grounded questions from inside the
HMI — the direct-connection surface where the UNS path is certified by the connection (no chat-gate).
**Owner action:** most steps run on the **PLC laptop** (Windows, Ignition gateway host).
**Cross-links:** [`provision-ignition-hmac.md`](provision-ignition-hmac.md) ·
[`.claude/rules/direct-connection-uns-certified.md`](../../.claude/rules/direct-connection-uns-certified.md) ·
[`docs/mira-ignition-secure-architecture.md`](../mira-ignition-secure-architecture.md) ·
`mira-pipeline/ignition_chat.py` · `ignition/webdev/FactoryLM/api/chat/doPost.py`

---

## The path (so you know what you're activating)

```
Perspective "Ask MIRA" button
  → Ignition WebDev  POST /system/webdev/FactoryLM/api/chat   (ignition/webdev/.../api/chat/doPost.py)
      signs the body with MIRA_IGNITION_HMAC_KEY
  → MIRA Cloud (VPS) POST /api/v1/ignition/chat                (mira-pipeline/ignition_chat.py)
      verifies HMAC + nonce → engine.process(uns_source="direct_connection")
  → grounded answer with citations
```

Two independent things must both be true: the **cloud side** has the HMAC key (it does, see
Status), and the **gateway side** has the WebDev resources deployed (this is the usual blocker).

---

## Status (as of 2026-06-07 — re-verify before relying on it)

| Component | State | Evidence |
|---|---|---|
| `MIRA_IGNITION_HMAC_KEY` in Doppler `factorylm/prd` | ✅ **present** | `doppler secrets -p factorylm -c prd --only-names \| grep HMAC` → `MIRA_IGNITION_HMAC_KEY` |
| Cloud endpoint mounted | ✅ | `mira-pipeline/main.py:293` includes `/api/v1/ignition/chat` router |
| Endpoint sets `source="direct_connection"` | ✅ | `ignition_chat.py:208` — when `asset_id` or `asset_context` present |
| HMAC + nonce-replay verification | ✅ | `ignition_chat.py:99-105` (503 if key unset, 401 on bad sig / replay) |
| WebDev resources deployed on the gateway | ⚠️ **verify** | last known **404 (not deployed)** 2026-06-06 — run Part B |
| `uns_required` rejection for a turn missing the identifier | ❌ **NOT implemented** | `ignition_chat.py:204-208` treats a no-asset turn as plain chat. Phase-6 gate-bypass work; tracked separately. Does **not** block activation for asset-bound turns. |

---

## Part A — Cloud side (already done; verify only)

The HMAC key is present in Doppler prd. If the cloud endpoint returns **503**, the key isn't in
the `mira-pipeline-saas` service block of `docker-compose.saas.yml` — follow
[`provision-ignition-hmac.md`](provision-ignition-hmac.md) Part A (it documents the 2026-06-06
finding that the var was missing from the pipeline block specifically). Do **not** SSH-restart
prod by hand — use `deploy-vps.yml`.

Verify (read-only):
```bash
doppler secrets -p factorylm -c prd --only-names | grep MIRA_IGNITION_HMAC_KEY   # name only, never the value
```

## Part B — Gateway side (PLC laptop) — the actual activation

> Run on the **PLC laptop** (the Ignition gateway host). CHARLIE has HTTP-only reach to the
> gateway and **cannot** do this remotely.

1. **Open PowerShell as Administrator** and pull the repo:
   ```powershell
   cd C:\Users\hharp\Documents\GitHub\MIRA
   git pull origin main
   ```
2. **Run the deploy script** (pushes WebDev resources + project into the gateway):
   ```powershell
   PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1 `
     -GatewayUrl "http://localhost:8088" -GatewayUser admin -GatewayPass <gateway-pass>
   ```
   It verifies the gateway is up (`/StatusPing`), locates the projects dir, and copies the
   `ignition/webdev/FactoryLM/` tree (including `api/chat/doPost.py` — the Ask MIRA handler).
3. **Set the gateway-side HMAC secret** so WebDev can sign requests. The WebDev signer reads it
   from a gateway-scoped location (see `ignition/webdev/FactoryLM/api/chat/signing.py`). It must
   be **byte-identical** to the Doppler `MIRA_IGNITION_HMAC_KEY`. Retrieve once:
   ```bash
   doppler secrets get MIRA_IGNITION_HMAC_KEY -p factorylm -c prd --plain   # paste into the gateway secret store, not into git
   ```
4. **Confirm the cloud base URL** the WebDev handler posts to is the prod gateway for
   `mira-pipeline-saas` (not a dev host). Check `ignition/webdev/FactoryLM/api/chat/doPost.py`.

## Part C — Verify it answers

1. **WebDev is deployed** (gateway, no auth on status):
   ```
   GET http://localhost:8088/system/webdev/FactoryLM/api/status   → 200 (was 404 before deploy)
   ```
2. **End-to-end from the HMI:** open the Perspective view with the **Ask MIRA** button on an
   asset-bound page (e.g. the conveyor cell), tap it, ask: **"What does GS10 fault code oC mean?"**
   Expect a grounded answer with a `--- Sources ---` citation block and **no** "are you sure
   you're looking at X?" gate question (the connection certified the asset).
3. **If you get 503 from cloud:** key missing in the pipeline service block → Part A.
   **If 401:** gateway HMAC secret ≠ Doppler value → redo B3.
   **If 404:** WebDev not deployed → redo B2.

---

## What this does NOT cover

- The **reject-on-missing-identifier** contract (`{"error":"uns_required"}`) for direct-connection
  turns that arrive without a UNS identifier — not yet implemented in `ignition_chat.py`
  (Phase-6 gate-bypass work). Asset-bound turns (the demo path) are unaffected.
- Tag streaming / ingest (`mira-relay /api/v1/tags/ingest`) — separate path, same HMAC key; see
  [`docs/integrations/ignition-tag-collector.md`](../integrations/ignition-tag-collector.md).
