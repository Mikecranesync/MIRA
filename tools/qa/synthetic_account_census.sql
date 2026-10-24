-- Synthetic-account census — READ-ONLY health + inventory of test/QA accounts (#4696).
--
-- WHY: on 2026-10-24 the long-lived prod QA probe account silently lapsed to an
-- expired trial, and every prod behavioural probe 307'd to /upgrade (#4676).
-- Nothing watched it. Meanwhile ~45 synthetic accounts had piled up, most of
-- them outside the qa-cleanup.yml selector. This census makes both visible on
-- a schedule, without writing anything.
--
-- RUNS ONLY via .github/workflows/qa-accounts-census.yml. Never from a code
-- session against prod (tools/hooks/prod-guard.sh; docs/environments.md).
--
-- READ-ONLY is enforced by the session, not by convention: the workflow sets
-- PGOPTIONS=-c default_transaction_read_only=on, this file sets it again below,
-- and the workflow proves it with a deliberate UPDATE that must be refused.
--
-- PRIVACY: section 1 names Doppler KEY NAMES, never emails. Sections 2-3 are
-- counts only — real customer emails never reach a log or an issue.
--
-- psql variables (REQUIRED — ON_ERROR_STOP makes a missing one fatal):
--   :ll_keys    comma-separated Doppler key names  (e.g. BETA_PROBE_QA_EMAIL,SYNTHETIC_DANA_EMAIL)
--   :ll_emails  comma-separated emails, same order as :ll_keys
--
-- Section 1 is printed unaligned (key|verdict|status|days_left) so the workflow
-- can parse it; verdict OK means the account clears the Hub middleware gate
-- (mira-hub/src/middleware.ts gateRedirect) with no expiry to fall off.

\set ON_ERROR_STOP on
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET default_transaction_read_only = on;

-- ── Section 1: long-lived QA accounts (alertable) ─────────────────────────────
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\echo '=== LONG_LIVED ==='
WITH ll AS (
  SELECT k.key, lower(trim(e.email)) AS email_lower
  FROM unnest(string_to_array(:'ll_keys', ',')) WITH ORDINALITY AS k(key, i)
  JOIN unnest(string_to_array(:'ll_emails', ',')) WITH ORDINALITY AS e(email, i)
    USING (i)
)
SELECT ll.key,
       CASE
         WHEN u.id IS NULL THEN 'MISSING'
         WHEN u.status = 'pending' THEN 'PENDING'
         WHEN u.status = 'expired' THEN 'LAPSED'
         WHEN u.status = 'trial' AND u.trial_expires_at IS NOT NULL
              AND u.trial_expires_at < NOW() THEN 'LAPSED'
         WHEN u.status = 'trial' THEN 'ON_TRIAL'
         ELSE 'OK'
       END AS verdict,
       COALESCE(u.status, '-') AS status,
       CASE WHEN u.status = 'trial' AND u.trial_expires_at IS NOT NULL
            THEN floor(extract(epoch FROM (u.trial_expires_at - NOW())) / 86400)::int::text
            ELSE '-' END AS days_left
FROM ll
LEFT JOIN hub_users u ON u.email_lower = ll.email_lower
ORDER BY ll.key;
\echo '=== END_LONG_LIVED ==='

-- ── Sections 2-3: inventory (counts only) ─────────────────────────────────────
\pset format aligned
\pset tuples_only off
\pset fieldsep ' '

-- Class regexes mirror isSystemAccount() in mira-hub/src/lib/users.ts (email
-- patterns only) plus the beta-gate stranger and reserved test domains. First
-- match wins, in the order below. Keep in step with users.ts when either moves.
\echo '=== SYNTHETIC INVENTORY (counts only) ==='
WITH census AS (
  SELECT
    CASE
      WHEN email_lower ~ '^(notebook-qa-|notebook-live-|adversarial-)[a-z0-9._+-]*@factorylm\.com$' THEN 'qa-disposable'
      WHEN email_lower ~ 'playwright' THEN 'playwright'
      WHEN email_lower ~ '\me2e[-_]' THEN 'e2e'
      WHEN email_lower ~ '\mprobe\M' THEN 'probe'
      WHEN email_lower ~ 'stranger' THEN 'stranger'
      WHEN email_lower ~ '(^|[-_.+])test[-_.@]' THEN 'test'
      WHEN email_lower ~ '@(example\.(com|org|net)|[a-z0-9-]*\.test|factorylm-test\.com)$' THEN 'test-domain'
      ELSE 'not-synthetic'
    END AS class,
    CASE
      WHEN status = 'expired' THEN 'lapsed'
      WHEN status = 'trial' AND trial_expires_at < NOW() THEN 'lapsed'
      ELSE status
    END AS state,
    email_lower ~ '^(notebook-qa-|notebook-live-|adversarial-)[a-z0-9._+-]*@factorylm\.com$' AS cleanup_covered,
    created_at
  FROM hub_users
)
SELECT class,
       state,
       count(*)                                         AS accounts,
       count(*) FILTER (WHERE cleanup_covered)          AS cleanup_covered,
       count(*) FILTER (WHERE created_at < NOW() - INTERVAL '7 days') AS older_than_7d
FROM census
WHERE class <> 'not-synthetic'
GROUP BY class, state
ORDER BY class, state;

\echo '=== ALL ACCOUNTS BY STATE (counts only) ==='
SELECT CASE
         WHEN status = 'expired' THEN 'lapsed'
         WHEN status = 'trial' AND trial_expires_at < NOW() THEN 'lapsed'
         ELSE status
       END AS state,
       count(*) AS accounts
FROM hub_users
GROUP BY 1
ORDER BY 1;
