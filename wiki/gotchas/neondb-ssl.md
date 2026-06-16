---
title: NeonDB channel_binding Fails from Windows
type: gotcha
updated: 2026-04-08
tags: [neondb, windows, ssl, postgres]
---

# NeonDB channel_binding Fails from Windows

## The Problem

PostgreSQL connections to NeonDB from Windows fail with a `channel_binding` error. This affects any direct NeonDB query from [[nodes/windows-dev]].

## Workaround

Run NeonDB queries from macOS nodes ([[nodes/bravo]] or [[nodes/charlie]]) instead. Both have working SSL connections to Neon.

## Affected Code

Any script using `NEON_DATABASE_URL` with `sslmode=require`:
- `mira-core/scripts/ingest_manuals.py`
- `mira-core/mira-ingest/db/neon.py`
- Direct `psql` connections

## Status

No fix found. Windows + Neon PgBouncer + channel_binding is a known incompatibility.
