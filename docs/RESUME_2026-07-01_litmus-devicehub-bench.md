# RESUME — Litmus Edge ↔ Micro820 Conveyor Bench (DeviceHub provisioning) — 2026-07-01

Paste the block below into a fresh Claude Code session to resume this work.

---

Resume the **Litmus Edge ↔ Micro820 conveyor bench** work (FactoryLM/MIRA as the
context layer reading the conveyor THROUGH Litmus Edge).

REPO: C:\Users\hharp\Documents\GitHub\MIRA
Read first: memory files `project_litmus_edge_bench.md`,
`reference_litmus_local_admin_password_reset.md` (in the .claude memory dir) — they
carry the full state. Full API notes: `plc/litmus/DEVICEHUB_API.md`.

## Environment (PLC laptop — this is LAPTOP-0KA3C70H, Tailscale 100.72.2.99)
- Litmus Edge container `le` (v4.0.14): UI `https://localhost:8443`, read API internal only.
- Bench Ethernet plugged IN → laptop has direct-LAN `192.168.1.50/24`; Micro820 at `192.168.1.100:502`.
- **Litmus local login: `admin` / `Factory2026!`** (reset this session; survives `docker restart`,
  wiped only by `docker rm`). Reset procedure: `reference_litmus_local_admin_password_reset.md`.
- **Dev Edition = 2-hour resettable license.** After a reset: re-activate (UI → System → Activation
  → 2-Hour Trial → Reset Trial + reCAPTCHA) AND re-provision DeviceHub (the 2h reset wipes device/tags).

## DONE this session (all verified)
- Fixed the local UI login (was THE blocker) + Playwright-verified end-to-end; license re-activated.
- Reverse-engineered the undocumented DeviceHub write API (`loopedge-dh`, binary is UPX-compressed).
- **Provisioned device `conv-101`** (id `17C803A8-4B85-42C4-9001-3306CC52B65C`, Modbus TCP → 192.168.1.100:502)
  **+ all 11 registers** (7 Holding `H`/word @106,107,108,109,114,117,118 + 4 Coils `C`/bit @0,3,5,9).
- **Litmus polls the PLC with ZERO modbus exceptions** — live values visible in DeviceHub → Browse.
- **PR #2390** (branch `feat/litmus-micro820-bench`, off main): `plc/litmus/` (mira_on_litmus.py,
  provision.py, README.md, DEVICEHUB_API.md). Commits `dd292ed1` + `9db5148a`.
- Saved Mike's read api-key to **Doppler `factorylm/dev` → `LITMUS_API_KEY`** (`pwiswgjz8oyz41c7ew5l150kxnvrv7og`).

## Key technical facts (full detail in plc/litmus/DEVICEHUB_API.md)
- **Mint a Bearer token (no UI):** `POST http://127.0.0.1:8081/auth/v2/login {"username":"admin","password":"Factory2026!"}` → `jwtAccess`. (Do this INSIDE the container; :8081 is internal.)
- **Device create** `POST /devicehub/devices` (internal :8085, or nginx `https://localhost:8443/devicehub`):
  `{name, driverId:"2AF1FA08-D638-11E9-BB65-2A2AE2DBCCE4"(Modbus TCP), properties:{...ALL STRINGS...}}`.
  Empty `properties:{}` returns the default keys. Modbus TCP props: networkAddress, networkPort, stationId, "Zero-Based Addressing".
- **Tags = "registers"** `POST /devicehub/registers`: `{deviceId, name:<CLASS>, TagName:<friendly>, address:<INT>, valueType:<word|bit>}`.
  CLASS codes: **H**=Holding(FC3), **I**=Input(FC4), **C**=Coils(FC1), **D**=Discrete(FC2).
- **GOTCHAS:** (1) Micro820 map is SPARSE — only 106-109,114,117,118 (HR) and 0,3,5,8-12 (coils) exist;
  Litmus batches contiguous addresses, so a batch spanning a missing address fails wholesale (exception 2).
  Scan first: raw FC3/FC1 single reads. (2) The poller CACHES registers — after add/deletes,
  reload: `docker exec le /command/s6-svc -r /run/service/loopedge-dh`.
- **Re-provision after a 2h reset:** `python plc/litmus/provision.py` (mints its own token from
  LITMUS_PASSWORD=Factory2026!; creates device + all 11 registers; then reload the poller).

## OPEN ITEM — the only remaining link: automated `--source litmus` read-through
`mira_on_litmus.py --source litmus` reads `GET /api/tags/by-device/{id}` on **loopedge-access**.
Blocked by an undocumented credential mismatch on this build:
- Read endpoint = `http://127.0.0.1:8094/api/tags/by-device/{id}` (env LOOPEDGE_ACCESS_SOCKET_API);
  **:8094 is NOT published to the host** — internal only.
- It checks the **`apiKey` header** and expects a **UUID-format** key. The "API Keys" the UI/API
  create (`POST /auth/v2/apikeys`, or Access Control → API Keys) are **32-char base32** `value`s →
  "invalid apiKey format". A UUID → "apiKey is not found". So the read API wants a DIFFERENT
  credential type (likely a "Token"/connector cred), not the standard API Key.
- To close it: find the UUID-format credential (check Access Control → Tokens vs API Keys), or expose
  :8094 (recreate `le` with `-p 8094:8094` — but that wipes state), then run:
  `LITMUS_API_KEY=<uuid-key> LITMUS_BASE=http://127.0.0.1:8094 python plc/litmus/mira_on_litmus.py --source litmus --device-id 17C803A8-4B85-42C4-9001-3306CC52B65C`
  (may need to run inside the container since it imports plc/conv_simple_anomaly/rules).

## Thesis status
Effectively proven: **Litmus COLLECTS** the conveyor (0 exceptions, live in UI) and **MIRA
CONTEXTUALIZES** that exact data (healthy verdict DC bus 320.5 V; injected-fault A1 critical) —
proven live via `--source plc`. Only the specific external-API read hop is unproven (the OPEN ITEM).

## Hard rules / conventions
- Do NOT commit unless explicitly asked. To commit `plc/litmus/` work: use a git worktree off
  `feat/litmus-micro820-bench` (or origin/main), stage ONLY plc/litmus/ files explicitly (never `git add -A`),
  commit, push (updates PR #2390), remove worktree. Main working tree has 27 foreign WIP files — LEAVE ALONE.
- Read-only toward the PLC (no writes). Litmus stays a bench/eval tool; NOT the mira-relay ingest path
  (one-pipeline law untouched, on HOLD per `project_ingest_one_pipeline`).
- PLC-lab work: explicit numbered read-only safety-railed steps (`feedback_plc_lab_safety_railed_execution`).

Start by confirming: container `le` up, login `admin`/`Factory2026!`, PLC reachable (192.168.1.100),
license active (re-activate if lapsed), then tackle the OPEN ITEM (UUID read-key) or re-provision if reset.
