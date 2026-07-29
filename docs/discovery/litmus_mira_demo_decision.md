# Decision — Litmus↔MIRA demo does NOT depend on the internal Litmus read API

**Date:** 2026-07-01
**Decision:** Do **not** block the garage-conveyor demo on the internal Litmus read API
(`loopedge-access :8094`). Use **`--source plc`** as the canonical live MIRA source; document
that Litmus is collecting the same conveyor data in parallel. The direct Litmus→MIRA read is a
**deferred follow-up** to be built on *supported* Litmus paths (see
`docs/integrations/litmus_supported_connector_plan.md`).

---

## What is PROVEN

- **Litmus collects the conveyor.** DeviceHub device `conv-101` + all **11 registers** (7 Holding
  `H` + 4 Coil `C`) poll the bench Micro820 (`192.168.1.100:502`) with **zero modbus exceptions**;
  live values are visible in the DeviceHub → Browse UI.
- **The PLC is reachable and the bench is healthy** (verified this session: token mints, device +
  registers present, `192.168.1.100:502` open, live raw read succeeds).
- **MIRA contextualizes the same live data.** `plc/litmus/demo_context_model.py --source plc` reads
  the exact same registers, maps them through the **approved CV-101 context model**, runs the
  A0–A12 machine-card rules, and answers *"Why is CV-101 stopped?"* with cited evidence — and
  **declines** questions that need unmapped signals (photo-eye jam, freq setpoint). Proven live and
  in deterministic replay.

## What is BLOCKED (and intentionally deferred)

The **direct** `--source litmus` read hop (`GET /api/tags/by-device/{id}` on `loopedge-access`).
Root cause, pinned this session:

- `loopedge-access` (the external read API) listens on **`127.0.0.1:8094` INSIDE the container**
  (`LOOPEDGE_ACCESS_SOCKET_API`); the port is **not published to the host** on the bench `docker run`.
- It validates a **UUID-format `apiKey` header** against its **own** boltdb store
  `/var/lib/loopedge-access/access.db` → bucket **`ApiKeys`**, which is **empty**.
- The API keys we can create (`POST /auth/v2/apikeys`, or UI Access Control → API Keys) live in a
  **different** store, **loopedge-auth**. Their base32 `value` → *"invalid apiKey format"*; a real
  auth-key `id` (a UUID) → *"apiKey is not found"* (UUID-shaped but not in the reader's store).
- Ruled out: no `loopedge-access` CLI create subcommand (only `run`), no REST create route (the
  swagger exposes read-only GETs), no static shared-secret env var, and **no boot-sync** from
  loopedge-auth (restarting the service left `ApiKeys` empty). The key is minted out-of-band via the
  gRPC mgmt port (`:9094`) or an unconfirmed UI "external API key" flow.

## Why `:8094` is NOT the production/demo path

1. **Container-internal.** Not host-reachable on the bench; a host-run MIRA cannot read it without
   recreating the container (`-p 8094:8094`), which **wipes** the proven-good provisioning.
2. **Undocumented, reverse-engineered auth.** A UUID key in a private boltdb bucket with no
   supported create path is not something to build a product on.
3. **Not the supported integration surface.** Litmus ships supported egress paths (official
   API/token flow, MQTT/NATS, exports, edge apps). The demo (and the product) should use those, not
   an internal socket.

## Why `--source plc` is the right weekend demo path

- It reads the **same live conveyor data** Litmus is collecting — the thesis ("MIRA contextualizes
  live industrial data") is proven on identical bytes.
- It is **dependency-free** (stdlib Modbus), **read-only** toward the PLC, and has a deterministic
  **replay** mode for a repeatable video/CI run with no PLC attached.
- Litmus' role in the demo is shown **in its own UI** (0-exception polling) — a parallel, honest
  proof that the data is flowing through Litmus, without coupling the code to an internal endpoint.

## What the future supported Litmus connector should use instead

See `docs/integrations/litmus_supported_connector_plan.md`. In short: official Litmus API/token
flow, supported DeviceHub/DataHub REST if available, **MQTT/NATS/broker or export/push** into a MIRA
receiver, or a Litmus edge-app/container — routed through the one-pipeline ingest contract
(`mira-relay/ingest_contract.py`) when that path comes off HOLD.

## Explicit do-nots (guardrails)

- ❌ Do **not** edit `access.db` (or any Litmus internal database).
- ❌ Do **not** rely on the container-internal `loopedge-access :8094` for the demo or the product.
- ❌ Do **not** treat **loopedge-auth** API keys as valid for **loopedge-access**.
- ❌ Do **not** reverse-engineer gRPC as the normal product path.
- ❌ Do **not** write to the PLC; do **not** make the demo depend on internet/cloud services.

## Cross-references

- Build/Discovery Recorder: `docs/discovery/litmus_mira_demo_context_model_build.md`
- Runbook: `docs/demo/garage_conveyor_context_model_demo.md`
- Future connector: `docs/integrations/litmus_supported_connector_plan.md`
- API notes (write side, reverse-engineered): `plc/litmus/DEVICEHUB_API.md` (PR #2390 branch)
