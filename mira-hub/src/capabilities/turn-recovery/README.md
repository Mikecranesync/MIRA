# Notebook turn recovery checks

Use an explicitly disposable loopback PostgreSQL database and the standard Hub
integration runner. No particular port, role or database name is required.

```sh
export TEST_DATABASE_URL=postgresql://test_user@127.0.0.1:55432/notebook_test
export MIRA_TEST_DB_CONFIRM=DISPOSABLE
npm run db:integration:setup
npm run test:integration -- src/capabilities/turn-recovery/
```

The database must already exist. Setup provisions the normal integration schema,
including migration115 for accepted component identities and selections. This is
local test provisioning; shared-environment migration and rollout authority are
separate. The suite rejects cloud hosts, production/staging names and URL options
through the existing disposable equipment-database guard.

The tests exercise actual HTTP handlers and restricted PostgreSQL with injected
authentication and controlled provider output. Password/JWT, built-browser,
deployed-source and technician acceptance require their own receipts.

Ordinary request-status GETs return bounded metadata. `includeTurn=1` additionally
hydrates the single exact completed request for that authenticated owner and
conversation, including historical rows outside the latest fifty. It never
returns another owner's or ownerless legacy turn. This read does not take over
the request, advance its lease or execute a retry.
