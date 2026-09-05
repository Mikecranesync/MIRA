# Notebook proof — HTTP harness for the canonical Notebook seam

Runs the technician loop against a **deployed** Hub and asserts on what came back:

```
register -> sign in -> create notebook -> upload a source -> attach it -> ask
        -> parse SSE frames -> assert
```

```bash
node tools/notebook-e2e/notebook_proof.mjs \
  --base https://app.factorylm.com \
  --email you@example.test --password '…' \
  --pdf docs/instructions/Conv_Simple_Anomaly_Catalog.pdf \
  --question "Which coil is published only after the slave-map-v2 reflash" \
  --expect-citation --expect-usage --expect-status answered
```

Exit `0` pass · `1` an assertion failed · `2` setup or transport failed.

To re-ask against a notebook that already exists (skips create/upload/attach):

```bash
node tools/notebook-e2e/notebook_proof.mjs --base … --email … --password … \
  --notebook <uuid> --doc <uuid> --question "…" --expect-status insufficient_evidence
```

There is also a **two-user private-history** variant (`--expect-private-history`) that proves a
second technician sharing the same Notebook cannot see your conversation — see
"Private history (two users, one shared notebook)" below.

## Why this exists next to `tools/mobile-e2e`

They answer different questions and neither replaces the other.

| | `tools/mobile-e2e` | this harness |
|---|---|---|
| Drives | a real Android emulator | HTTP only |
| Answers | "does the **app** behave" | "does the **server** behave" |
| Needs | Android SDK, emulator boot, APK build | node, ~10 s |
| Catches | picker/keyboard/permission/render defects | frame contract, citation scoping, refusal, seam on/off |

Both hit the same route — `POST /api/equipment-notebooks/{id}/chat/` — because mobile and web are
thin adapters over one canonical seam. When a Notebook answer looks wrong, run this first: if the
server frames are already wrong, no amount of device debugging will help.

## What the assertions actually protect

- **`[DONE]` terminator.** A truncated stream still delivers prose, so a technician (and a naive
  test) reads a partial answer as a complete one. Absence of `[DONE]` is an interrupted turn.
- **`--expect-citation`** additionally checks that every citation's `docId` is the source you
  attached. A citation from another document is a scoping defect, not a formatting one.
- **`--expect-usage`** asserts the `usage` frame exists, which is the observable signature of the
  canonical inference seam (`MIRA_CANONICAL_SEAM=1`). The legacy inline cascade emits no such frame,
  so this is how you tell which code path served a deployed turn without shell access to the box.
- **`--expect-status insufficient_evidence`** is how you test the refusal path: ask something the
  attached source cannot answer and assert the product says so rather than inventing an answer.

## Private history (two users, one shared notebook)

Migration `086_notebook_turn_owner.sql` made each **new** chat turn on an Equipment Notebook
private to the technician who asked it — the Notebook itself (manuals, evidence, asset identity)
stays shared by the tenant, but another technician using the same shared Notebook never sees your
conversation. This scenario proves it end-to-end, over HTTP, with two real accounts:

```bash
MIRA_TEST_DB_CONFIRM=DISPOSABLE node tools/notebook-e2e/notebook_proof.mjs \
  --base http://localhost:3100 \
  --email tech-a@example.test --password '…' \
  --second-email tech-b@example.test --second-password '…' \
  --db "$NEON_DATABASE_URL" \
  --expect-private-history
```

**`--db` safety (the only write this harness ever makes):** the guard inspects the host that
node-postgres will actually connect to (`pg-connection-string` parse), not the URL authority. It
refuses unless `MIRA_TEST_DB_CONFIRM=DISPOSABLE` is set; refuses any `host`/`hostaddr` query
parameter; requires the parsed host to be loopback/RFC1918 by exact rule (no suffix or prefix
matching — `127.0.0.1.evil.example` is not local); refuses production Hub `--base` hosts (trailing
dot and case normalised) and any `prod`/`prd`/`production` in host or path; and runs BEFORE the
first HTTP request, so a refused run registers nothing. A disposable **remote** dev database
additionally needs `--db-remote-ok`. User B is placed as `role='technician', status='approved'`
(the state an accepted invite produces). This is a DB placement, not an invite acceptance: B's own
throwaway tenant is left behind — fine for a disposable database, not something to run elsewhere.

(`--notebook <uuid>` also works here to reuse an existing shared notebook instead of creating one.)

What it proves:

- **User A can create a general turn on Mobile and reload it through Web.** The script POSTs a
  zero-source question with `mode: "general", sourceDocIds: []` — exactly the shape Mobile sends for
  a question with nothing attached — then does the same `GET /api/equipment-notebooks/{id}/` Web
  does on open, and asserts the turn is there with `sharedLegacy: false` and a non-null `ownerUserId`.
- **User B can use the same shared Notebook but cannot see User A's owned conversation.** User B is a
  second real account, placed into User A's tenant, reading and writing the *same* notebook id. Its
  `GET` must succeed (200 — the Notebook is shared) but must never contain User A's question, in
  either direction: before B has asked anything, after B asks its own question, and on User A's own
  final reload.

### Why `--db` exists here, and why it's safe

The rest of this file is intentionally DB-free (see "Deliberate non-features" below) — this is the
one exception, and it exists for **test setup**, never for assertions. There is no self-service
"join my colleague's tenant" HTTP endpoint (by design), so the only way to get a second real
technician into User A's tenant is the same move `mira-hub/scripts/provision-beta-gate.ts` makes:
mirror/place a row directly. Every *assertion* in this scenario still comes from HTTP responses
(chat frames, `GET` bodies) — `--db` is used exactly once, to run
`UPDATE hub_users SET tenant_id = …, role = 'technician' WHERE email_lower
= lower(…)`, mirroring what accepting a team invite does to that row.

Safety rules, enforced before any connection is opened:

- **`MIRA_TEST_DB_CONFIRM=DISPOSABLE` must be set in the environment**, mirroring
  `mira-hub/scripts/setup-integration-db.mjs`'s `assertDisposable()`. Missing it is exit `2`.
- **Any `--db` URL whose host or path contains `prod` or `prd` is refused**, exit `2`, before a
  connection is attempted. Unlike `setup-integration-db.mjs`, a **staging**-shaped URL is deliberately
  *not* refused here — a dev/staging DB is exactly what this scenario is for.
- `pg` is resolved lazily out of `mira-hub/node_modules/pg` (mira-hub's own dependency — see the
  "resolving `pg`" note below); nothing new is installed anywhere else.

## Deliberate non-features

- **No database access, outside the private-history scenario's one placement write.** Production DB
  reads go through `.github/workflows/db-inspect.yml` per the environments doctrine
  (`docs/environments.md`, hard rule #1). Every other flow in this file asserts only on what the
  technician can observe — the streamed frames. Verifying the durable spend ledger is db-inspect's
  job, not this script's.
- **No test account is created for you, and no password is stored here.** Pass your own; the register
  call tolerates `409 account already exists` so re-runs are cheap.
- **Not wired into CI.** It talks to a live deployment and burns real provider tokens (~$0.0002 a
  turn). It is an operator tool and a release-gate helper, not a unit test.

## Traps this encodes, so the next person does not rediscover them

1. **Trailing slashes are load-bearing.** The Hub 308-redirects slashless API paths; with
   `redirect: "manual"` you then parse the redirect body as JSON and get a syntax error nowhere near
   the real cause.
2. **`sourceDocIds` is required** on the chat body. Omit it and the route returns
   `422 no_sources_selected` — that check is the tenant/notebook ownership boundary evaluated *before*
   retrieval, so it is a feature.
3. **Notebook display names must be unique per tenant.** Creating one mints a `kg_entities` row keyed
   `(tenant, type, name)`; a duplicate surfaces as a 500 on `kg_entities_tenant_type_name_uq`, which
   reads like a server bug. The harness timestamps the name.
4. **Local/dev Hub serves under a `/hub` basePath; production does not.** Point `--base` at the right
   origin, and remember `NEXTAUTH_URL` must match it or sign-in silently yields no session.
5. **Resolving `pg` (private-history scenario only).** This repo has no root `node_modules` or npm
   workspaces — `pg` is `mira-hub`'s own dependency, installed only under `mira-hub/node_modules/pg`.
   Rather than add a second `pg` dependency here or require callers to remember a `NODE_PATH` env var,
   the script resolves it with `createRequire()` rooted at `mira-hub/package.json`, so Node's
   CommonJS resolver walks `mira-hub`'s own `node_modules` regardless of this file's location or the
   caller's cwd. Run `npm install` (or `bun install`) in `mira-hub/` first if `pg` isn't there yet;
   the single-user flow above never needs it.
6. **User B's session caches the tenant from sign-in time, not from the database.** NextAuth's `jwt()`
   callback (`mira-hub/src/auth.ts`) only copies `tenantId` onto the token when `authorize()` runs —
   i.e. on sign-in. After the `--db` placement, User B must sign in **again** before its session
   cookie reflects the new tenant; the scenario does this for you, but if you're driving the two
   accounts by hand, the same rule applies.
