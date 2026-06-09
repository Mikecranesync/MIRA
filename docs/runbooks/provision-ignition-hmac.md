# Provision: MIRA_IGNITION_HMAC_KEY (Ignition Cloud Chat Auth)

**Updated:** 2026-06-06
**Scope:** VPS production — `165.245.138.91`. Affects two services: `mira-relay` and `mira-pipeline-saas`.
**Symptom:** Ignition cloud-chat returns HTTP 503; tag ingest returns HTTP 401.
**Cross-links:** [`docs/integrations/ignition-tag-collector.md`](../integrations/ignition-tag-collector.md) · [`docs/environments.md`](../environments.md)

---

## Background

`MIRA_IGNITION_HMAC_KEY` is a shared HMAC-SHA256 secret between the Ignition gateway
(customer side) and MIRA Cloud (VPS side). Two VPS services consume it:

| Service | What it does | Error when key missing |
|---------|-------------|------------------------|
| `mira-pipeline-saas` | `/api/v1/ignition/chat` — Ignition cloud-chat endpoint | **HTTP 503** — source: `mira-pipeline/ignition_chat.py:165-167` |
| `mira-relay` | `/api/v1/tags/ingest` — tag streaming ingest | **HTTP 401** on every tag batch — source: `mira-relay/relay_server.py:207-208` |

> **Critical finding (2026-06-06):** `MIRA_IGNITION_HMAC_KEY` is currently **absent** from the
> `mira-pipeline-saas` service block in `docker-compose.saas.yml`. It exists only in the
> `mira-relay` block (line 438). Therefore fixing the 503 requires BOTH adding the var to the
> pipeline service block in `saas.yml` AND redeploying both services.
> Source: `docker-compose.saas.yml` lines 210-258 (pipeline) vs. 438 (relay).

---

## Prerequisites

- Doppler CLI installed: `doppler --version`
- Doppler access to `factorylm/prd` config
- GitHub CLI: `gh auth status`
- SSH to VPS: `ssh root@prod`
- PLC laptop access (for the Ignition gateway side of the key)

---

## Part A — Cloud Side (VPS)

### A1 — Generate or retrieve the key

If generating a new key (first-time setup):
```bash
openssl rand -hex 32
```

Copy the output. It will look like:
`a3f9b2c4e1d0f7a8b5c6d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3`

If retrieving an existing key (key was set before, just not propagated):
```bash
doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config prd --plain
```

If the key is empty or the command returns nothing, you must generate a new one (above).

### A2 — Set the key in Doppler

```bash
doppler secrets set MIRA_IGNITION_HMAC_KEY=<your-32-byte-hex-key> \
  --project factorylm --config prd
```

**Verify it was set:**
```bash
doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config prd --plain
```

Expected: the hex string you set (non-empty).

### A3 — Add the key to mira-pipeline-saas service block in saas.yml

The env var is **currently missing** from `mira-pipeline-saas`. Without this step, the pipeline
service will continue to return 503 even after the Doppler value is set.

File: `docker-compose.saas.yml`, in the `mira-pipeline-saas` service `environment:` block
(lines 210-258 context).

Add this line to the environment block of `mira-pipeline-saas`:
```yaml
      MIRA_IGNITION_HMAC_KEY: ${MIRA_IGNITION_HMAC_KEY:-}
```

Place it adjacent to the other `MIRA_*` environment variables in that block.

After editing, commit on the active branch and create a PR, OR if this is an emergency:
include the saas.yml change in the deploy trigger (the deploy workflow picks up saas.yml
from the HEAD of `main`).

> **Note:** The `mira-relay` block already has `MIRA_IGNITION_HMAC_KEY: ${MIRA_IGNITION_HMAC_KEY:-}`
> at line 438 of `docker-compose.saas.yml`. Only the pipeline block needs the addition.

### A4 — Redeploy both services

Redeploy both `mira-relay` and `mira-pipeline-saas` so the new secret is picked up:

```bash
gh workflow run deploy-vps.yml \
  -f services="mira-relay mira-pipeline-saas" \
  -f skip_staging_gate=true \
  -f skip_reason="Provision MIRA_IGNITION_HMAC_KEY — fix 503 on ignition chat + 401 on tag ingest"
```

Wait for completion:
```bash
gh run watch $(gh run list --workflow=deploy-vps.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

### A5 — Verify cloud side

**Test the ignition chat endpoint (should now return 200 or 400 on auth, not 503):**
```bash
curl -sv https://api.factorylm.com/api/v1/ignition/chat \
  -X POST -H 'Content-Type: application/json' \
  -d '{"message":"test"}' 2>&1 | grep -E "< HTTP|503|400|401|200"
```

Expected: `< HTTP/2 401` or `< HTTP/2 400` (auth rejection — not 503).
503 means the key is still missing from the pipeline container's env.

**Test the relay health:**
```bash
curl -sv https://api.factorylm.com/health 2>&1 | grep -E "< HTTP|200"
```

Expected: `< HTTP/2 200`

**Confirm the env var is live in the running container:**
```bash
ssh root@prod "docker exec mira-pipeline-saas printenv MIRA_IGNITION_HMAC_KEY | wc -c"
```

Expected: a number > 1 (the key length). If 0 or 1 (just a newline), the env var is still missing.

```bash
ssh root@prod "docker exec mira-relay printenv MIRA_IGNITION_HMAC_KEY | wc -c"
```

Also expected: > 1.

---

## Part B — Gateway Side (PLC Laptop — Ignition)

The Ignition gateway running on the PLC laptop must use the **same key** you set in Doppler.

> **Architecture note:** CHARLIE has HTTP-only reach to the gateway — no SSH, no SMB, no remote file editing.
> All Ignition-side work must be done **on the PLC laptop**.
> Source: `docs/mira-ignition-secure-architecture.md` §1.

### B1 — Edit `factorylm.properties` on the PLC laptop

Standard search paths (from `docs/integrations/ignition-tag-collector.md`):
- Windows: `C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties`
- Linux: `/usr/local/bin/ignition/data/factorylm/factorylm.properties` or `/var/lib/ignition/data/factorylm/factorylm.properties`

Set:
```properties
MIRA_HMAC_KEY=<same-hex-key-you-set-in-Doppler>
```

### B2 — Verify the gateway can reach the relay

From the PLC laptop or Ignition gateway script console:

```python
import system.net
result = system.net.httpGet("https://api.factorylm.com/health")
print(result)
```

Expected: `{"status":"ok"}` or similar 200 response.

### B3 — Test a signed tag batch

Trigger the tag-stream script manually (or wait for its next timer fire at 2000ms interval).
Watch the Ignition Gateway Logger at `FactoryLM.Mira.TagStream`:

| Log message | Meaning |
|------------|---------|
| `Streamed N/M allowlisted tags (attempts=1)` | Working |
| `Tag ingest failed status=401` | HMAC key mismatch — re-verify both sides have the same value |
| `Tag ingest failed status=503` | Cloud-side pipeline still has missing key — check Step A5 |
| `MIRA tag-stream not configured` | `TENANT_ID` or `MIRA_HMAC_KEY` missing from `factorylm.properties` |
| `No allowlisted tags to stream` | Allowlist empty or no tags matched — not an auth issue |

Source: `docs/integrations/ignition-tag-collector.md` §Verify.

---

## HMAC Signature Contract (for debugging mismatches)

The signed string format (source: `mira-relay/auth.py:70` context):
```
{tenant_id}\n{nonce}\n{timestamp}\n{sha256_hex(body_bytes)}
```

Headers sent by the gateway:
`X-MIRA-Tenant`, `X-MIRA-Nonce`, `X-MIRA-Timestamp`, `X-MIRA-Signature`

Replay window: ±300 seconds. Nonce TTL: 600s.
A `"bad_timestamp"` error means the gateway's clock is more than 5 minutes off.
A `"replay_detected"` error means the nonce was reused within 600s (retry logic bug).

---

## What Can Go Wrong

| Symptom | Cause | Action |
|---------|-------|--------|
| Still 503 after deploy | `MIRA_IGNITION_HMAC_KEY` still absent from pipeline env block in `saas.yml` | Confirm Step A3 was applied and merged; check `docker exec mira-pipeline-saas printenv` |
| 401 on tag ingest after key is set | Key value mismatch between Doppler and `factorylm.properties` | Re-fetch the Doppler value; paste exactly into `factorylm.properties` |
| `bad_timestamp` in relay logs | Gateway clock skewed > 300s from UTC | Sync NTP on the PLC laptop |
| `replay_detected` | Tag-stream retry logic sending the same nonce | Check `STREAM_MAX_RETRIES` logic in `ignition/gateway-scripts/tag-stream.py` |
| Key set in Doppler but container env still empty | Deploy workflow didn't run OR saas.yml still lacks the pipeline env line | Verify `docker exec mira-pipeline-saas printenv MIRA_IGNITION_HMAC_KEY` |
| Relay falls back to open/legacy bearer | `RELAY_LEGACY_BEARER=1` set in Doppler `factorylm/prd` | Remove or set to `0` — source: `mira-relay/relay_server.py:24` |

---

## Rollback

If the new key breaks existing integrations (key rotation scenario):

1. Set `MIRA_IGNITION_HMAC_KEY` back to the previous value in Doppler `factorylm/prd`
2. Redeploy: `gh workflow run deploy-vps.yml -f services="mira-relay mira-pipeline-saas" ...`
3. Update `factorylm.properties` on the PLC laptop to the previous value

There is no nonce state to clear — the relay's nonce store is in-memory and resets on container restart.
