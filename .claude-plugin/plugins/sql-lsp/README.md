# sql-lsp

PostgreSQL Language Server for the 16 .sql files in MIRA, including NeonDB migrations and HNSW index definitions.

## Install
`brew install postgres-language-server`

## Why postgres-language-server over sqls?
The original plan called for `sqls`, which is not available via brew or npm on macOS and requires Go (not installed on this system). `postgres-language-server` is a strictly better fit for MIRA since our database is NeonDB (Postgres), providing Postgres-aware syntax checking and validation.

## Features
- Postgres-specific syntax validation on `.sql` files
- Catches errors like malformed DDL, invalid function calls before apply-time
- Supports all Postgres versions including modern extensions (HNSW, jsonb operations, etc.)
