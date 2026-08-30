# Machine-memory preflight (manual, read-only)

This workflow answers one narrow question: does the protected target have enough
observed historian and replay evidence to evaluate the CV-101 machine-memory
preflight? It is an inspection gate, not a deployment or a fault-generation
procedure.

## Human boundary

**Mike only:** production dispatch, any deployment, flag change, database-secret
or target change, and creating a physical fault. An agent may create and test the
workflow, but must not dispatch it, access staging or production, deploy, change
Doppler, or claim a production GO.

## Dispatch

In GitHub Actions, manually choose **Machine-memory preflight** and select the
protected `staging` or `production` environment. The job binds that GitHub
Environment before the target secret is exposed.

Supply all required values from the reviewed operations record:

- tenant UUID that owns the expected CV-101 telemetry;
- exact UNS path: `enterprise.home_garage.conveyor_lab.conveyor_1`;
- inspected deployment commit SHA and approved historian effective-config hash;
- an exact UTC replay interval (`replay_from` inclusive, `replay_to` exclusive).

The protected environment supplies `MACHINE_MEMORY_PREFLIGHT_DATABASE_URL` plus
the environment-scoped variables `MACHINE_MEMORY_PREFLIGHT_DATABASE_IDENTITY_HASH`
and `MACHINE_MEMORY_PREFLIGHT_DATABASE_HOST`. Dispatchers cannot select or replace
these database trust anchors. The URL accepts only explicit TLS/timeout query
parameters; target-altering parameters such as `host`, `service`, or `options`
are rejected before a connection is opened.
Do not paste a URL into an input, issue, log, or artifact.

## What the workflow proves

Before opening a connection, the snapshotter validates the environment choice,
tenant UUID, fixed CV-101 path, local checkout SHA, replay bounds, expected host,
and a locally computed SHA-256 database identity. It retains only hashes; it does
not emit the URL, username, password, query string, database name, or canonical
identity.

It then opens one explicit `BEGIN TRANSACTION READ ONLY` transaction and applies
`SET LOCAL app.current_tenant_id` before every fixed, tenant-scoped CTE/SELECT.
The snapshot reads the historian heartbeat/effective-config evidence and the
bounded CV-101 event window: event and ingest times, deterministic window hash,
row/provenance/quality counts, and exact replay bounds. It never accepts SQL or
an endpoint from an input.

The pure evaluator decides `GO`, `NO_GO`, or `UNKNOWN` from those observed facts.
Expected inputs express the reviewed target/configuration only; they never replace
observed heartbeat or database facts. Missing/malformed targets or secrets, query
failures, `UNKNOWN`, and `NO_GO` all fail the workflow and can never be reported
as `GO`.

## Artifact and interpretation

The workflow uploads `machine-memory-preflight-<run-id>` even on a non-GO result.
It contains the redacted snapshot, verdict, ordered reason codes, checkout SHA,
workflow run ID, and SHA-256 of the shipped SQL contract. Do not treat artifact
presence as approval: only `verdict: GO` is a passed inspection; it is not
authority to deploy, change flags, or energize/create a fault.

If the result is `NO_GO` or `UNKNOWN`, preserve the artifact and investigate the
reason code through the normal change-control process. Do not retry by altering
the target, replay interval, heartbeat configuration, or physical equipment to
manufacture a GO result.
