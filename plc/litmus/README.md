<!-- ============================================================ -->
<!--  BENCH-ONLY. Not a customer-shipped surface. Read-only OT.   -->
<!--  Not the mira-relay ingest path (no ingest_contract /        -->
<!--  ingest_batch / tag_events). See .claude/rules/fieldbus-     -->
<!--  readonly.md and .claude/rules/one-pipeline-ingest.md.       -->
<!-- ============================================================ -->

# MIRA on top of Litmus Edge (bench proof)

**Thesis:** Litmus Edge is *an* industrial data platform — it collects and
normalizes the Micro820 conveyor's tags. **MIRA sits on top of it and adds the
intelligence Litmus does not:** it turns the raw tag wall into *equipment state
+ likely cause + the next check*, grounded in the Conv_Simple machine card
(`plc/conv_simple_anomaly` A0–A12 rules). This is the first proof that FactoryLM
is a context layer that rides on **any** platform, not just our own ingest path.

```
Micro820 + GS10  --Modbus/EtherNet-IP-->  Litmus Edge  --/api (x-api-key)-->  MIRA rules  -->  diagnosis
   (the machine)                            (the platform)                      (the value-add)
```

## Files

| File | Role |
|---|---|
| `mira_on_litmus.py` | **The proof.** Reads tags THROUGH Litmus (`--source litmus`) or direct (`--source plc`), runs the same MIRA rules, prints the contextualized diagnosis. Zero third-party deps. |
| `provision.py` | Re-creates the DeviceHub device + 11 verified tags in one command (survives the 2‑hour Developer-Edition reset). |

## One-time setup in the Litmus UI (per 2‑hour session)

Litmus DeviceHub **writes** go through the browser (Keycloak/OIDC) session; the
`x-api-key` external API is **read-only**. So:

1. **Log in + activate** the Developer Edition license (`https://100.72.2.99:8443`).
2. **Provision the device** — either:
   - click it once in DeviceHub (AB Micro850 Gen1.3 · `192.168.1.100` · port 44818 · slot 0; add the 11 tags by name), **or**
   - script it: grab the UI bearer token (F12 → Network → any `/devicehub/*` → `Authorization: Bearer …`), then
     `LITMUS_TOKEN=… python plc/litmus/provision.py`
3. **Create an API key** (Settings → API Keys) for the read path → `export LITMUS_API_KEY=…`

## Run the proof

```bash
# through Litmus (the thesis):
LITMUS_API_KEY=… python plc/litmus/mira_on_litmus.py --source litmus --device-id conv-101

# baseline, no Litmus in the path (same brain, same verdict):
python plc/litmus/mira_on_litmus.py --source plc
```

## Verified facts baked in (2026-06-30, read-only)

- PLC self-IDs over EtherNet/IP as **`2080-LC20-20QBB`** (Micro820), Allen-Bradley, FW 14.11.
- 11 readable global vars confirmed by CIP read-by-name; VFD analogs are **UINT**.
- Scales (raw → engineering): `vfd_dc_bus ÷10` (322 V, matches baseline), `vfd_frequency ÷100`, `vfd_current ÷100`, `vfd_voltage ÷10`. Mirrors `plc/conv_simple_anomaly/live_check.py`.

## Honest status

- ✅ **Validated & runs:** `mira_on_litmus.py --source plc` on live hardware — MIRA
  produces a grounded diagnosis (healthy *and* injected-fault paths).
- ⏳ **Pending one live-token pass:** `provision.py` and `--source litmus` POST/GET
  against the discovered `/devicehub` + `/api/tags/by-device` endpoints. The
  device-create JSON shape is Litmus-build-specific; the script prints the server
  response so a field mismatch is a 1-line fix. Validate against a real `LITMUS_TOKEN`
  before relying on it.

## What this is NOT

Not a production ingest path. Sending Litmus data into MIRA's canonical pipeline
(`mira-relay` → `ingest_batch`) is a separate, **gated** effort (HOLD until
#2280/#2281) and must obey `.claude/rules/one-pipeline-ingest.md`. This proof
reads Litmus and diagnoses; it never writes `tag_events` / `live_signal_cache`.
