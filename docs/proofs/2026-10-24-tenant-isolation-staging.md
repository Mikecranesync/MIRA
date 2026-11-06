# Tenant isolation proof — staging, 2026-10-24 (readiness board gate 7)

**Question:** can one customer reach another customer's notebook, manual, cited passage, chat, or files?
**Answer on this build:** no. All **34/34** checks passed, and a forced-red self-test failed as required.

| | |
|---|---|
| Hub | `https://app-staging.factorylm.com` |
| Build | v3.417.9, `db5e49097e928bd4eee2856fa3bb6296cddd3663` |
| Tool | `tools/qa/tenant_isolation_probe.py` (raw JSON: `2026-10-24-tenant-isolation-staging.json`) |
| Tenants | two throwaway strangers from `mira-hub/scripts/provision-beta-gate.ts`, both deleted afterwards (auth and data rows verified gone) |

## Method
- **Customer A** uploads a run-unique manual containing a secret sentinel phrase, confirms it as a notebook source, and chats about it.
  - Control: A's answer contains the sentinel, and A can read its own notebook, passage, PDF and node chat.
- **Customer B** then uses A's real ids against every read, write, injection and delete route. A B attempt passes only if it is refused (HTTP 400 or above) **and** the response contains none of A's ids, no sentinel and no PDF bytes.
  - B's own list and search screens may answer 200, but must not contain A's ids or the sentinel.
- **No login:** the same A ids must get 401.
- **After B's delete attempts:** A re-reads its notebook and PDF and re-asks its question. Everything is intact, and the answer is still cited from A's manual.
- **Detector proof:**
  - On A's own reads the leak detector fires (`leaked` contains SENTINEL or A's ids), so it can see a leak.
  - `--self-test` adds "A must be refused its own notebook". That run returned **FAIL 34/35, exit 1**, so the refusal check can go red.

## Results
| check | actor | request | expect | HTTP | result |
|---|---|---|---|---|---|
| A reads own notebook | A | `GET /api/equipment-notebooks/{nbA}/` | allow | 200 | **PASS** |
| A reads own cited passage | A | `GET /api/equipment-notebooks/{nbA}/sources/{docA}/passage/?page=1` | allow | 200 | **PASS** |
| A opens own PDF | A | `GET /api/namespace/files/{fileA}/` | allow | 200 | **PASS** |
| B reads A notebook | B | `GET /api/equipment-notebooks/{nbA}/` | refuse | 404 | **PASS** |
| B reads A thread | B | `GET /api/equipment-notebooks/{nbA}/?threadId={threadA}` | refuse | 404 | **PASS** |
| B reads A cited passage | B | `GET /api/equipment-notebooks/{nbA}/sources/{docA}/passage/?page=1` | refuse | 404 | **PASS** |
| B reads A source row | B | `GET /api/equipment-notebooks/{nbA}/sources/{docA}/` | refuse | 404 | **PASS** |
| B opens A PDF bytes | B | `GET /api/namespace/files/{fileA}/` | refuse | 404 | **PASS** |
| B reads A file record | B | `GET /api/files/{fileA}/` | refuse | 404 | **PASS** |
| B reads A upload | B | `GET /api/uploads/{docA}/` | refuse | 404 | **PASS** |
| B reads A node | B | `GET /api/namespace/node/{nodeA}/` | refuse | 404 | **PASS** |
| B reads A node files | B | `GET /api/namespace/node/{nodeA}/files/` | refuse | 404 | **PASS** |
| B reads A turn diagnostics | B | `GET /api/equipment-notebooks/{nbA}/turns/diagnostics/` | refuse | 404 | **PASS** |
| B chats in A notebook | B | `POST /api/equipment-notebooks/{nbA}/chat/` | refuse | 404 | **PASS** |
| A chats on own node (control) | A | `POST /api/namespace/node/{nodeA}/chat/` | allow | 200 | **PASS** |
| B chats on A node | B | `POST /api/namespace/node/{nodeA}/chat/` | refuse | 404 | **PASS** |
| B attaches A doc to own notebook | B | `POST /api/equipment-notebooks/278546c5-eb24-450d-9ee6-84045a470285/sources/` | refuse | 404 | **PASS** |
| B asks own notebook citing A doc | B | `POST /api/equipment-notebooks/278546c5-eb24-450d-9ee6-84045a470285/chat/` | no-leak | 403 | **PASS** |
| B uploads into A node | B | `POST /api/namespace/node/{nodeA}/files/` | refuse | 404 | **PASS** |
| B list /api/equipment-notebooks/ | B | `GET /api/equipment-notebooks/` | no-leak | 200 | **PASS** |
| B list /api/conversations/ | B | `GET /api/conversations/` | no-leak | 200 | **PASS** |
| B list /api/documents/?limit=200 | B | `GET /api/documents/?limit=200` | no-leak | 200 | **PASS** |
| B list /api/namespace/tree/ | B | `GET /api/namespace/tree/` | no-leak | 200 | **PASS** |
| B list /api/uploads/ | B | `GET /api/uploads/` | no-leak | 200 | **PASS** |
| anon reads A notebook | anon | `GET /api/equipment-notebooks/{nbA}/` | refuse | 401 | **PASS** |
| anon opens A PDF | anon | `GET /api/namespace/files/{fileA}/` | refuse | 401 | **PASS** |
| anon reads A passage | anon | `GET /api/equipment-notebooks/{nbA}/sources/{docA}/passage/?page=1` | refuse | 401 | **PASS** |
| B deletes A notebook | B | `DELETE /api/equipment-notebooks/{nbA}/` | refuse | 404 | **PASS** |
| B deletes A upload | B | `DELETE /api/uploads/{docA}/` | refuse | 404 | **PASS** |
| B deletes A file | B | `DELETE /api/namespace/files/{fileA}/` | refuse | 404 | **PASS** |
| B deletes A node | B | `DELETE /api/namespace/node/{nodeA}/` | refuse | 404 | **PASS** |
| A notebook intact after B deletes | A | `GET /api/equipment-notebooks/{nbA}/` | allow | 200 | **PASS** |
| A PDF intact after B deletes | A | `GET /api/namespace/files/{fileA}/` | allow | 200 | **PASS** |
| A still gets cited answer after B attacks | A | ` ` | allow | 200 | **PASS** |

## Not covered (honest scope)
- **Production.** Prod runs `c976d455` (v3.417.6), not this staging build. A prod run needs two prod test accounts.
  The prod QA account's trial is expired (#4676), and agents can't read prod credentials.
- **What differs between those builds.** `c976d455..db5e4909` changes two files near these routes:
  `mira-hub/src/lib/equipment-notebooks.ts` and `api/equipment-notebooks/[id]/photos/[fileId]/source`. The
  diff adds tenant-scoped queries (`WHERE tenant_id = $1`, `sessionOr401` plus `getNotebook(ctx.tenantId, …)`, and
  `FOR UPDATE` on the existing tenant predicate); it removes none.
  That is a reading of the diff, not a measurement on prod. The photo-source route itself was not probed.
- **Same-tenant users** (a technician seeing a teammate's private thread) and **role/permission** boundaries: not tested.
- **Shared OEM corpus visibility** (`knowledge_entries` `is_private=false`) is visible to everyone by design (`.claude/rules/knowledge-entries-tenant-scoping.md`). Only private uploads were tested.
- **Session revocation:** a deleted stranger's session token still returned 200 on a list endpoint (2026-10-23). That is the open #4665 (per-user JWT revocation), not an isolation break, since the token can only reach its own (now empty) tenant.
- **Mobile/native transport:** it uses the same APIs. The probe drives them directly.
