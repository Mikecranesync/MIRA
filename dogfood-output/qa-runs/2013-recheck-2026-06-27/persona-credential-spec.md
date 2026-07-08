## Summary
Follow-up to #2013. The single durable QA account (`hermes-qa-maint@example.com`) is a tenant **`owner`**, which bypasses all access checks (`access-control.ts:48` → `role==='owner'` returns `can:true`). So it proves the happy path but **exercises zero of the RBAC matrix, nothing platform-admin-gated, and no cross-tenant isolation.** This issue specifies the full set of credentialed personas needed for real Hub QA.

## Grounding (not invented)
- Role enum: `mira-hub/src/providers/access-control.ts:7` → `technician | manager | scheduler | admin | operator | owner`
- Permission matrix: same file, `PERMISSIONS` (lines 14–32)
- Platform-staff gating: `NAV_ITEMS` `review_queue.read` / `platform.users.read` (lines 117–122) — keyed off platform `status==='admin'`, **not** tenant role
- Tenant isolation tests exist but need a live 2nd tenant: `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts`
- Existing seed: `mira-hub/scripts/seed-synthetic-users.ts` creates 4 personas — **but all `role:"owner"`**, so they don't exercise the matrix.

## Credential spec

### Dimension 1 — tenant RBAC roles (one login each)
| Persona | Role | What only this role proves |
|---|---|---|
| Owner *(have it; currently dead — see #2013)* | `owner` | Baseline; bypasses RBAC. |
| Maintenance manager | `manager` | asset create/edit/delete, WO delete, reports, team read. Primary buyer. |
| Technician | `technician` | **Negative tests**: can create/edit WOs, must be DENIED asset-create, WO-delete, reports, team (cf. #1932 nav-vs-API). |
| Scheduler | `scheduler` | schedule CRUD + reports; denied asset/WO mutation. |
| Operator | `operator` | most-restricted; list/show + create requests only. |
| Tenant admin | `admin` | team CRUD + sees Review queue / Platform accounts links. (#2013 flagged this as "not available".) |

### Dimension 2 — platform status / allowlist (separate from tenant role)
| Persona | Needs | Why |
|---|---|---|
| Platform staff | account with platform `status==='admin'` (allowlisted) | Only one that reaches `/settings/review-queue` + `/admin/users` (cross-tenant approve/revoke). Requires prod DB/config change — human-owned. |

### Dimension 3 — tenant isolation
| Persona | Needs | Why |
|---|---|---|
| Second-tenant user | any role in a **different** `tenant_id` | RLS / cross-tenant leakage. Throwaway `*@example.com` signups OK here. |

## Acceptance criteria
- [ ] One durable, **non-expiring** login per role: manager, technician, scheduler, operator, admin (+ existing owner). Creds in Doppler `factorylm/dev`, not git.
- [ ] One platform-`admin`/allowlisted account.
- [ ] One second-tenant account (or documented throwaway-signup path).
- [ ] `seed-synthetic-users.ts` assigns the **real** roles (not all-owner) so re-seeding reproduces the set.
- [ ] All accounts log in without OTP and verified by session-token cookie presence (NOT the `ok:true` flag — see #2013 helper false-positive).
- [ ] None expire after 7 days (the lapse that broke #2013).

## Note
Minimum viable set ≠ 8 hand-built accounts: fix the seed script to assign real roles (covers 4–5), then add the platform-admin + second-tenant accounts. Prefer durability over count.
