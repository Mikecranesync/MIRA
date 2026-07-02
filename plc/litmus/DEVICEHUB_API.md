# Litmus Edge DeviceHub write API — reverse-engineered (2026-07-01)

The Litmus Edge DeviceHub write API is **undocumented publicly** and the
`loopedge-dh` binary is UPX-compressed (no greppable route strings). This is what
was learned by probing it live on the bench container `le` (v4.0.14), so we don't
have to rediscover it every 2-hour reset. BENCH-ONLY; read-only toward the PLC.

## Auth (two separate systems)

- **central.litmus.io** = cloud portal, ONLY for Developer-Edition license activation.
- **localhost:8443** = the node's OWN local account (`loopedge-auth` + boltdb). This is
  the UI login and the API credential. Current bench login: `admin` / `Factory2026!`.
- **Mint a bearer token** (no F12 needed) — POST to the internal login endpoint:
  ```
  POST http://127.0.0.1:8081/auth/v2/login   {"username":"admin","password":"..."}
  → { "jwtAccess": "<JWT>" }        # 5-min access token; use as  Authorization: Bearer <JWT>
  ```
  After a fresh login (mustChangePassword cleared) + license reset, the token carries full
  scopes incl. `dh:Modify`, `dh:ModifyDevices`, `dh:ModifyTags`.

## DeviceHub write endpoints (`loopedge-dh`, internal :8085, host via nginx `https://localhost:8443/devicehub`)

### Drivers
- `GET /devicehub/drivers` → catalog of ~80 drivers (id + name). Key ids:
  - **Modbus TCP** = `2AF1FA08-D638-11E9-BB65-2A2AE2DBCCE4` (the proven path — matches the
    live Modbus reads in `mira_on_litmus.py --source plc`).
  - CIP Ethernet = `60B722BA-4539-4D5D-9D2F-7C63F7FADBFB` (EtherNet/IP by-name alt).
- `GET /devicehub/drivers/{id}` → driver detail (Modbus TCP required fields: Network address,
  Network Port, Station ID, Zero-Based Addressing).

### Devices — `/devicehub/devices`
- `GET /devicehub/devices` → list.
- **Create:** `POST /devicehub/devices` with body:
  ```json
  { "name": "conv-101",
    "driverId": "2AF1FA08-D638-11E9-BB65-2A2AE2DBCCE4",
    "properties": { "networkAddress": "192.168.1.100", "networkPort": "502",
                    "stationId": "1", "Zero-Based Addressing": "1" } }
  ```
  **GOTCHA: every `properties` value must be a STRING** ("502", not 502) — the model is
  `map[string]string`. Sending `{}` for properties succeeds and the server returns the full
  DEFAULT property set (handy for discovering keys: `networkAddress`, `networkPort`,
  `stationId`, `overrideStationID`, `Zero-Based Addressing`, `maxAnalog`, `maxDiscrete`,
  `analogGap`, `discreteGap`, `requestTimeoutMs`).
- **Update:** `PUT /devicehub/devices/{id}` with the full `{name,driverId,properties}` body → 204.

### Tags are called **"registers"** — `/devicehub/registers`  (VERIFIED)
- `GET /devicehub/registers` → list (`[]` when empty).
- **Create:** `POST /devicehub/registers`, body:
  ```json
  { "deviceId": "<id>", "name": "H", "TagName": "vfd_dc_bus", "address": 109, "valueType": "word" }
  ```
  - `deviceId` (string).
  - **`name` = the register CLASS code** from the driver catalog (the UI Add-Tag "Name" dropdown):
    - **`H`** = Analog Output Holding Registers → **FC3** (`valueType` word/int16/int32/uint32/float32/…)
    - **`I`** = Analog Input Registers → **FC4**
    - **`C`** = Coils → **FC1** (`valueType` `bit`);  **`D`** = Discrete Input Contacts → FC2 (bit)
    - Arbitrary labels / Modbus refs (`"40110"`, `"HR109"`) are rejected `"Unknown register name"`.
  - `TagName` (string) — the friendly tag name; read back as `tagName`.
  - `address` (**int**, NOT string — opposite of device properties). 0-based when the device
    has `"Zero-Based Addressing":"1"`.
  - `valueType` — `word` (unsigned 16-bit) for the VFD analogs, `bit` for coils.
  - Real validation lives in `core/registers_validation.go`; failures surface only in the
    `loopedge-dh` log (`/var/log/loopedge-dh/current`), not the HTTP body (`500 null`). **Read that log.**
- **Delete:** `DELETE /devicehub/registers/{id}` → 204.
- **GOTCHA — poller caches the register set + batches contiguous addresses.** After add/deletes the
  driver keeps polling the OLD set; and it batches adjacent addresses into one Modbus read, so a
  batch that spans a non-existent address on a SPARSE PLC map fails wholesale (`exception 2, illegal
  data address`). Fixes: provision only addresses that actually exist (single-read scan first), and
  **reload the driver**: `docker exec le /command/s6-svc -r /run/service/loopedge-dh`. Verified: with
  the real 11 addresses + a reload, polling runs with **zero exceptions**.

## Read API (external) — `loopedge-access`
- Serves on **`127.0.0.1:8094` INSIDE the container** (env `LOOPEDGE_ACCESS_SOCKET_API`); this port is
  **not published to the host** in the bench `docker run`, so the read path is container-internal.
- `GET /api/tags/by-device/{deviceID}` → live tag values (the path `mira_on_litmus.py --source litmus`
  reads through). `GET /api/devices`, `/api/version` also available.
- **Auth: an API key** — create via `POST http://127.0.0.1:8081/auth/v2/apikeys` `{"name":"..."}`
  (returns `{id, value}`), or UI System → Access Control → API Keys. **OPEN ITEM:** the exact header
  name/format the reader accepts (`apiKey` header rejects the raw `value` as *"invalid apiKey format"*;
  grab a working key + header from the UI Network tab). Swagger security nominally says the
  `Authorization` header ("Shared secret").

## Persistence note
- The 2-hour Developer reset wipes DeviceHub config → re-run provisioning after each reset.
- `auth.db` (the login) lives in the container writable layer and SURVIVES `docker restart`
  (only `docker rm` wipes it). See `../../` memory `reference_litmus_local_admin_password_reset`.
