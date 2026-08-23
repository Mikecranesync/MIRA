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

## Deliberate non-features

- **No database access.** Production DB reads go through `.github/workflows/db-inspect.yml` per the
  environments doctrine (`docs/environments.md`, hard rule #1). This harness asserts only on what the
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
