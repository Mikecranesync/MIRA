-- Migration 102: the identity-change revocation (migration 101) never touches a
-- manual the technician confirmed (#4075, Codex #4118 r7 F11).
--
-- Migration 101's trigger disables sources the background search enabled
-- (match_evidence carries "autoAcquisitionKey") when the notebook's identity
-- changes. A technician can later confirm such a source through the sources
-- PATCH, which changes match_state/enabled_by_default but keeps match_evidence,
-- so the marker survives the human decision. 101 therefore demoted a manual the
-- technician had deliberately confirmed, contradicting its own header ("manuals
-- a technician attached or confirmed are never affected"). This redefines the
-- function to skip match_state = 'user_confirmed'. The trigger itself is
-- unchanged (it calls the function by name). Migration 101 is left as applied
-- (an applied migration is immutable — mira-hub-migrations rule 8).
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION revoke_stale_auto_acquired_manuals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_key text := upper(regexp_replace(coalesce(NEW.manufacturer, ''), '[^A-Za-z0-9]', '', 'g'))
    || '|' || upper(regexp_replace(coalesce(NEW.model, ''), '[^A-Za-z0-9]', '', 'g'))
    || '|' || upper(regexp_replace(coalesce(NEW.catalog_number, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
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
  RETURN NEW;
END;
$$;

COMMIT;
