# Runbook: MIRA on an offline Android tablet (edge profile)

The same MIRA Hub, running on one Android tablet with its own database. It works with no
network: a technician signs in on the tablet, picks a machine, asks about the manual and
gets the manual's own words with the page, records jobs, notes and photos, and keeps all
of it across restarts. No answer model runs (see [Local model](#local-model)).

Validated on a Samsung Galaxy Tab S9 FE (SM-X510, Exynos 1380, 5.6 GB RAM, Android 16),
Termux from Google Play, Node 24.17, PostgreSQL 18.2. Scripts: `tools/edge-tablet/`.

| Script | Runs on | Does |
|---|---|---|
| `build-edge.sh` | build host with `mira-hub/node_modules` | builds a committed SHA with the edge `NEXT_PUBLIC_*` overrides, packs `edge-hub-<sha12>.tgz` + `.sha256` |
| `install.sh <tgz> [host]` | operator machine | install or update; keeps the previous release; rolls back by itself if the sign-in page does not answer within 60 s |
| `rollback.sh [host]` | operator machine | switch back to the previous release (database unchanged) |
| `backup.sh [host] [dir]` | operator machine | `pg_dump` of the device DB (file bytes live in it) + `hub.env`, copied off and checksum-verified |
| `restore.sh <tgz> [host] [--into db]` | operator machine | restore into the live DB (Hub stopped), or into a scratch DB to prove a backup |
| `hubctl.sh start\|stop\|restart\|status` | tablet | start Postgres if needed, start/stop the Hub, show release + sign-in status |
| `hub.env.example` | tablet | the settings file; edge profile on, no cloud keys |

`host` is an ssh alias for the tablet's Termux sshd (port 8022), e.g. in `~/.ssh/config`:
`Host tab` / `HostName <tablet address>` / `Port 8022` / `User <termux user>`.

## Device layout

```
~/hub -> ~/mira-edge/releases/<sha12>   active release (Next standalone server, BUILD_SHA)
~/mira-edge/releases/                   active + previous + one older
~/mira-edge/previous                    path rollback.sh switches to
~/mira-edge/backups/                    backups made on the device (also copied off)
~/hub.env                               settings (chmod 600; holds AUTH_SECRET and DB password)
~/pgdata                                PostgreSQL data, port 5433, TLS with the device cert
```

## Update a device (normal case)

1. Build: on the build host, check out the release SHA and run `tools/edge-tablet/build-edge.sh`.
   It refuses a dirty tree and a client bundle that still calls the cloud `/hub` API base.
2. Back up first: `tools/edge-tablet/backup.sh tab ./edge-backups`.
3. Install: `tools/edge-tablet/install.sh dist/edge-tablet/edge-hub-<sha12>.tgz tab`.
   It prints the active release, its SHA and `sign-in page 200`. If the new release does
   not answer, it switches back and prints the last lines of `~/hub.log`.
4. Check on the tablet: open `http://127.0.0.1:3000`, sign in, open a project, ask one
   question, tap a citation.

Rollback at any time: `tools/edge-tablet/rollback.sh tab`. A release that needs a database
migration is not rolled back by this; restore the backup from step 2 with `restore.sh`.

## Prove a backup restores (do this on every new device and after updates)

```
tools/edge-tablet/backup.sh tab ./edge-backups
tools/edge-tablet/restore.sh ./edge-backups/mira-edge-<ts>.tgz tab --into mira_edge_restoretest
```

Then compare row counts of every table in both databases and drop the scratch database.
Measured 2026-11-08 on the tablet: 85 MB database (one 454-page manual, 1,104 chunks, a
photo, a job, a note), all 322 tables identical row counts after restore.

## Provision a new device (first time)

1. Termux (Google Play build): `pkg install openssh nodejs-lts postgresql git`; set a key
   for sshd; in Developer options turn on **Disable child process restrictions** (Android
   12+ kills Termux background children otherwise).
2. PostgreSQL: `initdb ~/pgdata`, port 5433, `ssl = on` with a self-signed certificate
   (`~/pgdata/server.crt`; the Hub requires TLS to its database). Termux has no `ltree` or
   `pgvector`: build both from source (PostgreSQL 18 contrib `ltree`; pgvector 0.8.x, link
   with `-lm`). Extensions used: btree_gist, ltree, pgcrypto, uuid-ossp, vector.
3. Schema: **gap, see below.** Today the schema is a schema-only dump of a running Hub
   database (no data), with the Neon-only `pg_session_jwt` extension removed. After loading:
   grant `factorylm_app` usage on schema `public` and rights on all tables, sequences and
   functions (the dump carries no grants), and give the tenant a row in the legacy `tenants`
   table as well as `hub_tenants` (manual chunks reference it).
4. `cp tools/edge-tablet/hub.env.example ~/hub.env`, fill in the DB password and a fresh
   `AUTH_SECRET` (`openssl rand -base64 32`), `chmod 600 ~/hub.env`.
5. `install.sh` the release. The Hub refuses to start if a cloud key is set or a listed
   endpoint points off the device, and blocks every non-loopback connection at runtime.
6. Create the site's first account and project on the tablet (see the open item below),
   then load manuals from the project screen.

## What the device does and does not do

- **Answers** are the manual's own passages, verbatim, with the page (`[n]`, manual name,
  printed revision and page when the manual prints them). When the question names a
  parameter, the page that defines it comes first. No answer model runs.
- **Reported active incidents** (smoke, fire, arcing, a shock, a machine moving on its own)
  get a fixed STOP / DO NOT OPERATE response and no troubleshooting.
- **Other hazard-flagged questions** get the controlled "safety review not available"
  response, because no safety reviewer runs on the device. An evidence-only mode
  (manual pages under a warning) exists behind `MIRA_EDGE_EVIDENCE_ONLY_FAULTS`. It is
  **off** and stays off until the owner approves it.
- **Network:** with `MIRA_PROFILE=edge` the Hub refuses to start with cloud credentials or
  off-device endpoints, and refuses every outbound connection that is not loopback,
  redirects included. It does not control Chrome's own background traffic; a managed
  browser or kiosk policy is needed for a device-wide no-telemetry claim.
- **Not available offline:** general chat with no project, photo text reading (OCR), new
  manual search on the internet, Open WebUI/Telegram connections, cloud CMMS sync.

## Local model

Measured on the tablet with the Hub and Postgres running (llama.cpp built on-device with
dot-product instructions, 4 threads), 2026-11-08:

| Model | Read (prompt) | Write | Free RAM low point | Notes |
|---|---|---|---|---|
| Qwen2.5 0.5B Q4_0 | 364 tok/s (512), 312 tok/s (1024) | 40.7 tok/s | — | quality too low to cite (W0) |
| Qwen2.5 1.5B Q4_0 | 103 tok/s (512), 97 tok/s (1024) | 16.0 tok/s | 1.59 GB (from 2.35 GB) | server RSS 1.89 GB |

On the real P01.12 question with three cited passages (1,018 prompt tokens), the 1.5B
model answered in 15.0 s (10.2 s reading, 4.7 s writing). The wording was right, but it put
the wrong citation number on a claim, so it fails the citation rule. On USB power the
battery still drained about 1.1 A while the model ran. **Decision: the device ships the
cited-excerpt mode; no model is enabled.** A model can be reconsidered when it passes a
citation-accuracy question set on this hardware.

## Known gaps (owner)

| Gap | Owner / tracker |
|---|---|
| Fresh database needs a schema-only dump; repo migrations cannot build one | follow-up issue (packaging lane) |
| First account on a fresh device: offline sign-up/sign-in from scratch not yet exercised on a clean browser profile | device acceptance run |
| In-page PDF preview is blank on Android Chrome; "Open document in a new tab" lands on the page | #5305 (shared UI lane) |
| GS11N catalog questions against the GS10 family manual | #5285 / #5294 (BRAVO) |
| Large work-packet loading memory | #5289 (BRAVO) |
| Health endpoint answers 503 offline (`INGEST_URL` required) | follow-up |
| Chrome background traffic | device policy (managed browser / kiosk) |
