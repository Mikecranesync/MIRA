-- Migration 104: confirming an identity promotes a matching CANDIDATE-basis
-- manual acquired for the SAME key before confirmation (#4160 S6, PRD R3/D2).
--
-- S6 lets a background manual search start from a mere CANDIDATE identity (a
-- label read, or a proposed-but-unconfirmed maker+part) — see
-- src/capabilities/notebook-manual-acquisition.ts basis="candidate". That
-- search's writer (fencedWriter, same file) NEVER enables a source before
-- confirmation: it always lands match_state='candidate',
-- enabled_by_default=false, stamping match_evidence.autoAcquisitionKey = the
-- key the technician's eventual PATCH bind would produce, plus
-- match_evidence.candidateApplicability = 'verified' | 'candidate' — the
-- deterministic applicability verdict from manual-applicability.ts (the judge
-- may only ever REJECT a document, never auto-approve one — PRD R8).
--
-- When the technician then confirms that SAME identity (the PATCH bind writes
-- identity_status = 'user_confirmed' with the matching manufacturer/model),
-- this migration promotes any such row to match_state='verified',
-- enabled_by_default=true, IN THE SAME TRANSACTION as the identity write — so
-- there is never a window where a confirmed identity's already-verified
-- manual exists but is not yet usable.
--
-- A row is left untouched (stays a disabled candidate) when:
--   - its autoAcquisitionKey does not match the newly-confirmed identity's key
--     (correcting the identity to a DIFFERENT part leaves a stale candidate
--     disabled, exactly like 101's revocation does for the enabled case), OR
--   - its candidateApplicability is not exactly 'verified' (a 'candidate'
--     verdict — the search found a document but could not confirm it covers
--     this exact part — never self-promotes just because the identity was
--     confirmed; a human still reviews it in Sources), OR
--   - a human has already ruled on it: match_state is no longer 'candidate'
--     (rejected / user_confirmed — never second-guessed here), or
--     match_evidence.revokedBecause is set (101/102 already disabled it for
--     an identity change away from its key; S6 does not resurrect that).
--
-- This CREATE OR REPLACEs the trigger FUNCTION defined by migration 101 and
-- redefined by migration 102 — not the function body those migrations shipped
-- (101/102 are applied and therefore immutable —
-- .claude/rules/mira-hub-migrations.md rule 8) but a NEW version of the same
-- function name, which the `equipment_notebooks_revoke_auto_manuals` trigger
-- (101, unchanged) already calls by name. 101's revocation branch and 102's
-- carve-out (never touch a technician-confirmed source) are preserved
-- byte-for-byte below; this migration only ADDS the promotion branch.
--
-- Idempotent (CREATE OR REPLACE FUNCTION, no state mutation of existing
-- rows). Single transaction.

BEGIN;

CREATE OR REPLACE FUNCTION revoke_stale_auto_acquired_manuals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_key text := upper(regexp_replace(coalesce(NEW.manufacturer, ''), '[^A-Za-z0-9]', '', 'g'))
    || '|' || upper(regexp_replace(coalesce(NEW.model, ''), '[^A-Za-z0-9]', '', 'g'))
    || '|' || upper(regexp_replace(coalesce(NEW.catalog_number, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  -- 101/102, unchanged: an identity change away from the key a background
  -- search enabled a manual for turns that manual back into a disabled
  -- candidate. Never touches a technician-confirmed source.
  UPDATE equipment_notebook_sources s
     SET enabled_by_default = false,
         match_state = 'candidate',
         match_evidence = s.match_evidence || jsonb_build_object('revokedBecause', 'notebook identity changed')
   WHERE s.tenant_id = NEW.tenant_id
     AND s.notebook_id = NEW.id
     AND s.enabled_by_default = true
     AND s.match_state IS DISTINCT FROM 'user_confirmed'
     AND s.match_evidence->>'autoAcquisitionKey' IS NOT NULL
     AND (NEW.identity_status <> 'user_confirmed' OR s.match_evidence->>'autoAcquisitionKey' <> new_key);

  -- S6, new: confirming the SAME identity a candidate-basis search already
  -- found a verified-applicability manual for promotes it here, in this same
  -- transaction. Never a row a human already ruled on, never a mismatched
  -- key, never a 'candidate' applicability verdict.
  IF NEW.identity_status = 'user_confirmed' THEN
    UPDATE equipment_notebook_sources s
       SET match_state = 'verified',
           enabled_by_default = true,
           match_evidence = s.match_evidence || jsonb_build_object('promotedBecause', 'identity confirmed')
     WHERE s.tenant_id = NEW.tenant_id
       AND s.notebook_id = NEW.id
       AND s.match_state = 'candidate'
       AND s.match_evidence->>'autoAcquisitionKey' = new_key
       AND s.match_evidence->>'candidateApplicability' = 'verified'
       AND s.match_evidence->>'revokedBecause' IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
