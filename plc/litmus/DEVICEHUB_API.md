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

### Tags are called **"registers"** — `/devicehub/registers`
- `GET /devicehub/registers` → list (`[]` when empty).
- **Create:** `POST /devicehub/registers`. Fields discovered from validation errors:
  - `deviceId` (string, the device id)
  - `name` (string) — **must be a value from the driver's register-name catalog**; arbitrary
    labels or Modbus refs like `"40110"`/`"HR109"` are rejected `"Unknown register name"`.
    **OPEN ITEM — exact accepted format TBD** (capture it from the DeviceHub UI's Add-Tag form).
  - `TagName` (string) — the friendly tag name (e.g. `vfd_dc_bus`).
  - `address` (**int**, NOT string — opposite of device properties) — the Modbus offset.
  - The real validation lives in `core/registers_validation.go`; failures surface only in the
    `loopedge-dh` log (`/var/log/loopedge-dh/current`), not the HTTP body (which returns `500 null`).
    **Read that log to debug register creates.**

## Read API (external, `x-api-key`) — `loopedge-access`
- `GET /api/tags/by-device/{deviceID}` (header `x-api-key`) → live tag values. This is the path
  `mira_on_litmus.py --source litmus` reads through. Get the key from the UI: System → Access Control → API Keys.

## Persistence note
- The 2-hour Developer reset wipes DeviceHub config → re-run provisioning after each reset.
- `auth.db` (the login) lives in the container writable layer and SURVIVES `docker restart`
  (only `docker rm` wipes it). See `../../` memory `reference_litmus_local_admin_password_reset`.
