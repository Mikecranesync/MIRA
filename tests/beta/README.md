# `tests/beta/` — the beta release gate

One question decides beta readiness:

> **Can a stranger upload their own equipment manual, ask a real troubleshooting question, and get
> a grounded answer with citations from that manual — without Mike manually fixing anything?**

## Files

| File | Role |
|---|---|
| `beta_ready_upload_retrieval_citation.py` | **The RELEASE GATE.** Run explicitly (name isn't `test_*` on purpose — it hits live dev/staging endpoints). `xfail(strict)` until the gap closes. |
| `test_upload_retrieval_citation.py` | Lane-2 twin: a runnable anchor (`test_retrieval_reads_only_knowledge_entries`, passes now) + the same end-to-end gate (`xfail`). Collected by normal `pytest`. |
| `_gate.py` | The one real flow both files call: upload the fixture → poll → ask → judge citation. Never seeds `knowledge_entries` directly (that would hide the gap). |
| `fixtures/gs10_fault_codes.pdf` | The manual under test (GS10 fault `oC` = overcurrent). Regenerate: `python3 fixtures/_make_gs10_pdf.py`. |

## Run

```bash
# Anchor + xfail (no env needed — proves the suite is wired):
pytest tests/beta/test_upload_retrieval_citation.py -v

# Harness protocol unit tests (no env — pin the NodeChat SSE/messages contract):
pytest tests/beta/test_gate_harness.py -v

# The real gate (DEV/STAGING only — NEVER point at prod):
#   Point BOTH urls at the folder=brain NodeChat surface (PR #1592) — the surface
#   that actually makes an uploaded manual citable. The <id> is a UNS node the
#   stranger created ("New Folder" in /namespace) and attached the manual to.
#   Do NOT use /api/uploads/folder — that door writes only the Open WebUI KB and
#   can never cite (it's the gap, not the fix).
BETA_GATE_UPLOAD_URL=https://<staging>/api/namespace/node/<id>/files \
BETA_GATE_CHAT_URL=https://<staging>/api/namespace/node/<id>/chat \
BETA_GATE_TENANT=<tenant-uuid> \
BETA_GATE_COOKIE='next-auth.session-token=<jwe>' \
pytest tests/beta/beta_ready_upload_retrieval_citation.py -v
```

`BETA_GATE_COOKIE` (added 2026-06-09) is the auth the Hub NodeChat routes
actually require — they gate on a next-auth session cookie (`sessionOr401`), not
the `BETA_GATE_API_KEY` bearer. Mint the cookie the same way
`mira-hub/tests/e2e/folder-brain-proof.spec.ts` does: `POST /api/auth/register`
→ `GET /api/auth/csrf` → `POST /api/auth/callback/credentials` and read the
`next-auth.session-token` from the `Set-Cookie` response. (The bearer env still
works for JSON engine/pipeline surfaces.) The provisioner must also mirror the
auth-side tenant id into the data-side `tenants` table — see the
`folder-brain-proof` `seedFixture` note — so the upload's chunk INSERTs satisfy
the `knowledge_entries.tenant_id` FK.

The harness speaks both the NodeChat contract (`messages` body + SSE response) and
JSON engine/pipeline surfaces — see `_gate._ask`. The client follows redirects and
forwards `BETA_GATE_COOKIE`; point the URLs at the **canonical trailing-slash** form
(`/files/`, `/chat/`) — the Hub runs `trailingSlash: true`, and httpx drops the
`Cookie` header across a 308, so a slash-less URL authenticates as 401.

**Live-run finding (2026-06-09) — the real write blocker is a missing GRANT.** Driving
the gate against a local `next dev` on dev Neon with real minted-session auth got
through the real `/api/namespace/node/<id>/files/` door and the `unpdf` chunking, then
**500'd at the chunk INSERT: `permission denied for table knowledge_entries`**.
`node-knowledge-ingest.ts` inserts under `withTenantContext` (the `factorylm_app` role),
but `011_grant_app_kb_access.sql` granted that role only **SELECT** on
`knowledge_entries` — no INSERT. So PR #1592's write path cannot actually write a chunk
under the app role: **no uploaded manual becomes citable until the INSERT grant lands.**
Fix: migration `049_grant_app_knowledge_entries_insert.sql` (`GRANT INSERT ON
knowledge_entries TO factorylm_app`). Applying it is the gated dev→staging→prod
`apply-migrations.yml` step. Until it is applied to a durable surface, the gate stays
RED and the xfail stays on.

**Status (post-#1592, 2026-06-08):** PR #1592 (`folder = brain`) **merged** to main
(`6758e7e6`) and wired the upload→retrieval **write + plumbing** **on the NodeChat surface**:
a PDF attached to a `/namespace` node is chunked into `knowledge_entries` (`ingest_route='v2'`,
generated `content_tsv`) and `retrieveNodeChunks` reads exactly those rows, subtree-scoped,
into a cited NodeChat answer. The full stranger flow exists in the UI (empty tenant →
"New Folder" → attach manual → ask).

**Caveat (found + fixed 2026-06-08):** an ephemeral-pg replay of the literal INSERT+SELECT
against the real schema showed the gate's own question returned **0 rows** — `retrieveNodeChunks`
used `plainto_tsquery` (AND-combines every term), so "what does oC **mean**?" injected an
off-vocabulary word no chunk contains → empty retrieval. Fixed in `mira-hub/src/lib/manual-rag.ts`
(precise AND first, OR fallback when empty). So "wired" became "actually retrieves" only with that
fix — a reminder that inspection ≠ execution for BM25 query semantics.

The gate is **still RED** until it's actually run green against a provisioned **dev/staging**
node + tenant (the gate excludes hand-seeded assets — it must be an *unseen* manual on a
*self-served* node). Note Hub routes authenticate via a **next-auth session cookie**, not the
`BETA_GATE_API_KEY` bearer — whoever provisions the run must supply working auth (e.g. a
session cookie or an auth-shimmed dev instance). When the gate passes, `xfail(strict=True)`
turns the run **red** — that's the signal to remove the marker and declare the gate met.
See `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`.
