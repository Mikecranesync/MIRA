# MIRA Multi-Tenant Telegram Bot — Design Spec

**Date:** 2026-04-26
**Status:** Approved (brainstorming complete) — ready for plan
**Owner:** harperhousebuyers@gmail.com (BRAVO node)
**Approach:** App-level tenant scoping + deep-link invites (industry-standard pattern)

---

## 1. Context

The `@FactoryLMDiagnose_bot` Telegram bot serves a single tenant today: the engine takes one `MIRA_TENANT_ID` env var at process boot (`mira-bots/telegram/bot.py:49`) and uses it for every request. The `TelegramChatAdapter` hard-codes `tenant_id=""` in every normalized event (`mira-bots/telegram/chat_adapter.py:98`). Anyone who knows the bot's username can DM it.

The team needs each member to have their own private conversations and memory while sharing the team's knowledge base, equipment registry, and CMMS work orders. This is the standard multi-tenant SaaS chatbot shape: **one tenant per organization, multiple users per tenant, per-user conversation state, shared tenant data.** Slack apps, Linear, Front, Intercom, Notion all work this way.

The good news: most of the data model is already built. NeonDB has `plg_tenants`, `mira_users`, `identity_links`. SQLite has `chat_tenant_map`. `IdentityService.resolve()` exists in `mira-bots/shared/identity/service.py`. `chat_tenant.resolve()` exists in `mira-bots/shared/chat_tenant.py`. The work in this design is **wiring + onboarding**, not net-new architecture.

## 2. Goals & non-goals

**Goals:**
1. Each team member gets a private Telegram conversation with the bot, isolated from other members' chats and memory.
2. The team shares a single knowledge base, equipment registry, and CMMS work-order pool (Option B from brainstorming).
3. New members are onboarded via a one-tap deep-link invite that an admin generates.
4. Existing usage of the bot (current single-tenant chat) keeps working with zero interruption during rollout.
5. The pattern extends cleanly to Slack/web/email later — same `IdentityService`, different adapter.

**Non-goals:**
1. Multiple teams served by one bot container (one bot = one tenant for now).
2. Postgres Row-Level Security (RLS). Neon's PgBouncer runs in `pool_mode=transaction`, and `SET` / `SET LOCAL` is explicitly listed as unsupported with pooled connections per [Neon docs](https://neon.com/docs/connect/connection-pooling). RLS is therefore deferred — application-level scoping is the safer fit for this stack today.
3. Renaming the BotFather handle to `@MIRA_bot`. Cosmetic, separate task; called out at end as one-line action.
4. Self-serve signup. Invite-only matches the customer model.

## 3. Architecture

```
   ┌────────────────┐  Telegram Update
   │   Telegram     │ (from.id = ext_user_id, chat.id = chat_id)
   └───────┬────────┘
           │
   ┌───────▼─────────────────────────────────┐
   │ TelegramChatAdapter.normalize_incoming  │  ← MODIFIED
   │   tenant_id = chat_tenant.resolve(      │     Calls existing
   │       external_user_id)                 │     chat_tenant.resolve()
   └───────┬─────────────────────────────────┘
           │
   ┌───────▼─────────────────────────────────┐
   │ ChatDispatcher.dispatch                 │  ← MODIFIED
   │   user = IdentityService.lookup_only(   │     Lookup-only (no
   │       "telegram", external_user_id)     │     auto-create) — strangers
   │   if user is None:                      │     get None even if env-var
   │       return "ask admin for invite"     │     fallback would have given
   │   engine.process(... tenant_id=user.t,  │     them a tenant_id
   │                       user_id=user.id)  │
   └───────┬─────────────────────────────────┘
           │
   ┌───────▼─────────────────────────────────┐
   │ Supervisor.process(*, tenant_id,        │  ← MODIFIED
   │                       mira_user_id)     │     New per-call kwargs;
   │   workers query through                 │     constructor tenant_id
   │   TenantScopedSession(tenant_id)        │     becomes a default
   └───────┬─────────────────────────────────┘
           │
   ┌───────▼─────────────────────────────────┐
   │ DB layer                                │  ← NEW WRAPPER
   │   TenantScopedSession enforces          │     SQLAlchemy session
   │   WHERE tenant_id = :tid on tenant      │     subclass; raises on
   │   tables; raises on unscoped queries    │     unscoped query
   └─────────────────────────────────────────┘
```

The architecture is the one your code is already drawn for. We're filling dotted lines.

## 4. Components

### 4.1 Modified files

| Path | Change | Approx. LOC |
|------|--------|-------------|
| `mira-bots/telegram/chat_adapter.py:98` | Replace `tenant_id=""` with `chat_tenant.resolve(external_user_id)` | 15 |
| `mira-bots/telegram/bot.py:43-55` | Wire `IdentityService` into `ChatDispatcher`; instantiate `Authorizer` with `ADMIN_TELEGRAM_IDS` env var | 30 |
| `mira-bots/telegram/bot.py:610` | New `/start` handler that detects an invite token in `context.args` and consumes it | 25 |
| `mira-bots/shared/identity/service.py` | Add `lookup_only(platform, external_user_id) -> MiraUser \| None` — does NOT auto-create; used by dispatcher to gate strangers without ever consulting the env-var fallback | 25 |
| `mira-bots/shared/chat/dispatcher.py:55-110` | Use `IdentityService.lookup_only()` to gate strangers (returns `None` for anyone with no `identity_links` row, regardless of env-var fallback). Then thread `tenant_id` + `mira_user_id` from the resolved user into `engine.process()` | 15 |
| `mira-bots/shared/engine.py` (`Supervisor.process`) | Accept `tenant_id` and `mira_user_id` as per-call kwargs; pass to workers and DB calls | 40 |

### 4.2 New files

| Path | Purpose | Approx. LOC |
|------|---------|-------------|
| `mira-bots/shared/tenant/session.py` | `TenantScopedSession` — SQLAlchemy session subclass that requires `tenant_id` at construction and refuses to execute queries that don't filter on it (regex check on tenant tables) | 80 |
| `mira-bots/shared/tenant/invites.py` | `mint_invite(tenant_id, email, ttl_h=72) -> str` returns a base64url token; `consume_invite(token, telegram_user_id, display_name) -> MiraUser` validates expiry/single-use and creates the link | 120 |
| `mira-bots/telegram/admin_commands.py` | `/invite <email>`, `/team`, `/revoke @user`, `/invite_status` — all gated by `ADMIN_TELEGRAM_IDS` allow-list | 100 |
| `mira-mcp/migrations/00X_tenant_invites.sql` | New `tenant_invites` table | 20 |
| `.ast-grep-rules/no-unscoped-tenant-query.yml` | CI rule: fail PR if a `text("SELECT ... FROM (mira_users\|conversation_state\|feedback_log\|api_usage\|asset_qr_tags)...")` string lacks `tenant_id` in the same string | 30 |

### 4.3 New table: `tenant_invites`

```sql
CREATE TABLE tenant_invites (
    token        TEXT PRIMARY KEY,                       -- 32-char base64url, unguessable
    tenant_id    UUID NOT NULL REFERENCES plg_tenants(id),
    email        TEXT NOT NULL,                          -- pre-fills mira_users.email on consume
    display_name TEXT NOT NULL DEFAULT '',               -- optional admin-supplied name hint
    minted_by    TEXT NOT NULL,                          -- Telegram user_id of admin who minted
    expires_at   TIMESTAMPTZ NOT NULL,                   -- minted_at + 72h by default
    consumed_at  TIMESTAMPTZ,                            -- NULL until clicked
    consumed_by  TEXT                                    -- Telegram user_id that consumed it
);
CREATE INDEX idx_tenant_invites_unconsumed ON tenant_invites (tenant_id) WHERE consumed_at IS NULL;
```

Token is 32 chars, well within the 64-character ceiling for Telegram start parameters per [official Telegram docs](https://core.telegram.org/bots/features#deep-linking). Allowed character set is `A-Za-z0-9_-` — base64url encoding fits exactly.

### 4.4 What is NOT being built (already exists)

- `plg_tenants`, `mira_users`, `identity_links` tables in NeonDB
- `IdentityService.resolve(platform, external_user_id, tenant_id, *, email, display_name)` — `mira-bots/shared/identity/service.py:56`
- `chat_tenant.resolve(chat_id)` and `chat_tenant.set_mapping(chat_id, tenant_id)` — `mira-bots/shared/chat_tenant.py:88`
- `tenant_resolver.derive_atlas_password(tenant_id)` — `mira-mcp/tenant_resolver.py:31`
- The cascade, FSM, vision pipeline, ingest service — tenant-naive only because nobody passes `tenant_id`; the call sites are easy to amend

## 5. Three canonical data flows

### 5.1 Path A — existing user sends a message (hot path)

```
Telegram /update
  → TelegramChatAdapter.normalize_incoming(raw)
      tenant_id = chat_tenant.resolve(from.id)        # SQLite, LRU-cached, ~0.01ms
                                                       # (informational; not used as auth)
  → ChatDispatcher.dispatch(event)
      mira_user = IdentityService.lookup_only(         # NeonDB, single-row SELECT;
                    "telegram", from.id)               # NO auto-create, NO env-var fallback
      if mira_user is None:                            # → strangers always rejected here,
          return "ask admin for invite"                # even if MIRA_TENANT_ID is set
  → Supervisor.process(chat_id, msg, *,
                        tenant_id=mira_user.tenant_id,
                        mira_user_id=mira_user.id)
      workers query DB through TenantScopedSession(tenant_id)
  → adapter.render_outgoing
```

The `chat_tenant.resolve()` call is kept in the adapter for two reasons: (1) consistency with how Slack/Email adapters already populate `event.tenant_id`, and (2) for legacy code paths that still read it. **But it is never the source of truth for "is this user enrolled."** That decision lives exclusively in `IdentityService.lookup_only()`, which checks the `identity_links` table and only returns a user when an explicit row exists. Strangers cannot ride the env-var fallback into the team's tenant.

### 5.2 Path B — admin mints an invite (rare)

```
Admin in Telegram: /invite alice@team.com
  → bot checks Authorizer.is_admin(from.id) against ADMIN_TELEGRAM_IDS
  → invites.mint_invite(tenant_id, email="alice@team.com")
      INSERT INTO tenant_invites (token, tenant_id, email,
                                   minted_by, expires_at = now() + interval '72 hours')
      returning token
  → uses python-telegram-bot helper:
      url = telegram.helpers.create_deep_linked_url(bot.username, token)
  → bot replies: "Send Alice this link: <url>  (expires Sun 2026-04-29 21:13 UTC)"
```

`telegram.helpers.create_deep_linked_url` is the official PTB helper for generating
`https://t.me/<bot>?start=<token>` URLs — see [PTB deep-linking example](https://docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html).

### 5.3 Path C — new user clicks invite link (one-time)

```
Alice opens https://t.me/MIRABot?start=tok_abc123 in Telegram
  → Telegram client opens the chat and sends "/start tok_abc123" to bot
  → bot.start_command runs
      payload = context.args[0] if context.args else ""    # PTB pattern
      if not payload:
          render normal welcome (existing user with mapping) or
                 "ask admin for invite" (stranger)
      else:
          mira_user = invites.consume_invite(
              token=payload,
              telegram_user_id=str(update.effective_user.id),
              display_name=update.effective_user.full_name)
          # consume_invite internally does:
          #   1. SELECT FROM tenant_invites WHERE token=? AND consumed_at IS NULL AND expires_at > now()
          #   2. IdentityService.resolve("telegram", telegram_user_id, invite.tenant_id,
          #                              email=invite.email, display_name=...)
          #   3. chat_tenant.set_mapping(telegram_user_id, invite.tenant_id)
          #   4. UPDATE tenant_invites SET consumed_at, consumed_by WHERE token=?
          # All within one DB transaction; on failure, no partial state.
      reply: "Welcome to MIRA, Alice. You're connected to <team_name>. Try sending me a question or a photo."
```

This is the canonical Telegram deep-linking flow. The official Telegram Bot Features docs explicitly call out this exact use case: *"It could be a command that launches the bot — or an authentication token to connect the user's Telegram account to their account on another platform"* ([core.telegram.org/bots/features#deep-linking](https://core.telegram.org/bots/features#deep-linking)).

## 6. Onboarding UX surface

### 6.1 Admin commands (allow-listed via `ADMIN_TELEGRAM_IDS=123,456` env var)

| Command | Behavior |
|---------|----------|
| `/invite alice@team.com [Alice Smith]` | Mints token, returns full `t.me/...` link, valid 72h |
| `/team` | Lists enrolled members: name, email, last-active (from `mira_users` joined to `conversation_state`) |
| `/revoke @username` or `/revoke <user_id>` | Deletes from `chat_tenant_map` and (optionally) clears `identity_links`; next message blocks |
| `/invite_status` | Lists outstanding (unconsumed, unexpired), expired, and recently consumed invites |

### 6.2 Member commands

| Command | Behavior |
|---------|----------|
| `/start` (no token) | If enrolled: normal welcome. If unenrolled: "Ask your admin for an enrollment link." |
| `/start <token>` | Consume invite, enroll, welcome by name |
| `/whoami` | Returns: tenant name, display_name, email, linked platforms (e.g. "telegram, slack") |
| `/leave` | Confirm-prompt → removes own `chat_tenant_map` row. Re-enrollment requires a new invite. |

### 6.3 Stranger experience (DM from someone with no `identity_links` row for `(platform="telegram", external_user_id=from.id)`)

> *"Hi — I'm MIRA, your team's maintenance assistant. I'm invite-only. Ask your admin to send you an enrollment link."*

No further responses to that user_id until they `/start <token>` with a valid invite. Standard Slack-app-style behavior. The check is on `identity_links` (an explicit, intentional row), not on `chat_tenant_map` or env-var fallback — strangers can never slip through via configuration defaults.

## 7. Backward compatibility & migration

The dispatcher's strict `lookup_only()` gate (§5.1) means rollout would lock out *every existing user* unless we backfill `identity_links` rows for them first. So the order matters:

1. **Pre-deploy (one-time backfill script — `tools/backfill_tenant_map.py`, run before the new bot image is pushed):**
   - For every distinct `chat_id` in `conversation_state`:
     - In Telegram private DMs, `chat_id == user_id`. Group chats are skipped (out of scope for Option B).
     - Insert `mira_users(tenant_id=MIRA_TENANT_ID, display_name="legacy", email="")` if not exists for that user
     - Insert `identity_links(platform="telegram", external_user_id=user_id, tenant_id=MIRA_TENANT_ID, mira_user_id=...)` if not exists
     - Insert `chat_tenant_map(chat_id=user_id, tenant_id=MIRA_TENANT_ID)` if not exists
   - Idempotent; safe to re-run. Verify row counts match before deploying.
2. **Day 0 (deploy):** Existing chats keep working because the backfill gave them `identity_links` rows. New strangers get the "ask admin for invite" reply.
3. **Day 7+:** Audit `mira_users` rows where `display_name='legacy'`; ask the admin to rename them and fill in emails. The `MIRA_TENANT_ID` env var becomes purely a default for the backfill script; the bot's request path no longer depends on it.

This sequence guarantees that no stranger ever rides the env-var fallback into the team's tenant: the dispatcher gate is always backed by an explicit `identity_links` row, whether created by backfill (existing users) or by `consume_invite()` (new users).

## 8. Failure modes

| Failure | Behavior | Rationale |
|---|---|---|
| NeonDB unreachable on a request (`lookup_only` raises) | Reply: *"MIRA is temporarily unavailable. Please retry shortly."* Do NOT fall through to the env-var tenant — failing closed prevents stranger-leak via DB outage. | Outages are short; cross-tenant leak is permanent. Loud over silent. |
| `chat_tenant_map` SQLite locked / missing | No effect — auth lives in NeonDB `identity_links`, not in SQLite | SQLite is now informational only |
| Invite token expired | "This link has expired. Ask your admin for a new one." | Standard |
| Invite token already consumed | "This link was already used. If this wasn't you, tell your admin." | Detects link-leak; admins can investigate |
| Wrong tenant_id in invite (e.g., admin typo) | `consume_invite` validates against `plg_tenants` foreign key; reject at mint time | Fail loud at mint, not at click |
| User has `chat_tenant_map` row but no `identity_links` row | Treated as stranger (lookup_only returns None). Admin must mint a fresh invite. | Self-heal-on-explicit-action; never silently grant access |
| `TenantScopedSession` catches an unscoped query (dev or staging) | Raises `UnscopedQueryError`, kills the request loudly | Loud failure beats silent leak |
| `TenantScopedSession` catches an unscoped query in prod | Logs ERROR with full stack, returns generic "MIRA error" to user; PagerDuty/Discord webhook | Logged for triage; no leak |
| Two admins issue invites for the same email | Both work; second consumption fails as "already consumed" by tenant_id+token, not by email | Invites are tokens, not email reservations |
| Admin tries `/invite` from outside the allow-list | "Sorry, only admins can invite." Logs the attempt with `from.id` | Standard auth gate |

## 9. Testing strategy

### 9.1 Unit (pytest, runs every save via existing dev loop)

| Test file | What it asserts |
|-----------|-----------------|
| `mira-bots/tests/test_chat_tenant_resolve.py` | DB hit, env-var fallback, no-mapping-no-fallback returns `""` |
| `mira-bots/tests/test_invites.py` | mint roundtrip; consume happy path; expired rejected; double-consume rejected; wrong tenant_id at mint rejected |
| `mira-bots/tests/test_tenant_scoped_session.py` | Unscoped SELECT/UPDATE/DELETE on tenant tables raises `UnscopedQueryError`; scoped query passes; cross-tenant write blocked |
| `mira-bots/tests/test_telegram_adapter_tenant.py` | Adapter populates `tenant_id` from `chat_tenant.resolve()` correctly; empty when unenrolled |
| `mira-bots/tests/test_admin_commands.py` | Allow-list gating; `/invite` returns valid `t.me/...` URL; non-admin gets refusal |

### 9.2 Integration (pytest, SQLite-in-memory + fixture tenant + 3 fake users)

`mira-bots/tests/test_multi_tenant_isolation.py` asserts:
- User A's `/reset` does not touch User B's `conversation_state` row
- A photo from User A does not appear in User B's KB search results
- User A's `/whoami` shows their identity, not User B's
- A `chat_tenant_map` revoke for User C blocks the next message but does not affect Users A and B

### 9.3 E2E (existing `mira-telegram-test-runner` Telethon profile)

`mira-bots/telegram_test_runner/` already exists for E2E (`docker-compose.yml:153`).
Add one new scenario: full invite-to-chat flow.
- Admin pod: mint invite via `/invite`
- Test runner pod: open the resulting `t.me/...` URL via Telethon, send `/start <token>`, then send a diagnostic question, assert reply within 30s
- Cleanup: `/revoke` the test user

## 10. Defense in depth — two upgrades that buy 80% of RLS at 5% of the cost

### 10.1 `TenantScopedSession`

Subclass of SQLAlchemy `Session` that requires `tenant_id` at construction. On `execute()`, if the query string mentions any tenant-scoped table name and lacks the literal `tenant_id` substring, raise `UnscopedQueryError`. Fast, predictable, and catches "I forgot the WHERE clause" at runtime in dev and integration tests — exactly the failure mode RLS would catch in prod, without Neon's PgBouncer constraints.

Tenant-scoped tables (initial list, easy to extend):
- `mira_users`
- `identity_links`
- `tenant_invites`
- `conversation_state` (when migrated to NeonDB; SQLite scope is per-process for now)
- `feedback_log`
- `api_usage`
- `asset_qr_tags`

### 10.2 ast-grep CI rule (`.ast-grep-rules/no-unscoped-tenant-query.yml`)

Static-check rule that fails the PR if any `text("...")` SQLAlchemy literal hits one of the tenant-scoped tables and doesn't contain `tenant_id` in the same string. Plugs into the existing `.github/workflows/code-review.yml` pipeline.

Together: the static rule catches the bug at write-time; the runtime wrapper catches anything that slips past (including dynamically constructed queries the static rule can't see).

This combination is what Sentry, Linear, and PostHog all describe in their multi-tenant security write-ups.

## 11. Renaming the bot to "MIRA" (one-line action)

Outside this design's scope but called out for completeness:
1. In Telegram, message `@BotFather` → `/setname` → choose `@FactoryLMDiagnose_bot` → enter `MIRA`.
2. (Optional) `/setusername` → if `@MIRA_bot` is available globally, claim it. Note: changing the username changes every existing `t.me/...` link.
3. Update `mira-bots/telegram/bot.py` welcome strings.

The bot **token does not change** when the name or username changes; existing webhook/poll continues to work.

## 12. Out of scope (deferred)

- Multi-team-per-bot (would require token-on-every-chat dispatch, OAuth-style)
- Postgres RLS (deferred — see Goals/Non-goals §2)
- Web/Slack/email adapters wiring (data model supports it; adapters are the next milestone)
- Self-serve signup with email magic-link (today: invite-only)
- Per-user KB partitioning (today: shared team KB by design — Option B)

## 13. References

| Topic | Source |
|-------|--------|
| Telegram deep-linking spec (64-char start param, A-Za-z0-9_- charset, base64url recommended, official auth-token use case) | [core.telegram.org/bots/features#deep-linking](https://core.telegram.org/bots/features#deep-linking) |
| python-telegram-bot deep-linking example (`helpers.create_deep_linked_url`, `context.args` payload extraction, handler ordering) | [docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html](https://docs.python-telegram-bot.org/en/v21.11.1/examples.deeplinking.html) |
| Neon connection pooling (`pool_mode=transaction`, `SET`/`SET LOCAL` not supported with pooled connections — the reason RLS is deferred) | [neon.com/docs/connect/connection-pooling](https://neon.com/docs/connect/connection-pooling) |
| Postgres RLS official docs (for future reference when we revisit) | [postgresql.org/docs/current/ddl-rowsecurity.html](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) |
| Existing identity scaffolding | `mira-bots/shared/identity/service.py`, `mira-bots/shared/chat_tenant.py`, `mira-mcp/tenant_resolver.py` |
| Existing tenant-aware retrieval | `RETRIEVAL_BACKEND=openviking` + `MIRA_TENANT_ID` in `mira-mcp/CLAUDE.md` |

## 14. Estimated effort

- Net new code: ~470 LOC across 10 files (5 modified, 5 new)
- Migrations: 1 new SQL file
- Tests: 5 new test files
- One backfill script (idempotent)

Ballpark for a single focused implementation pass: **~1 day of plan execution** by an agent following the implementation plan that comes next.
