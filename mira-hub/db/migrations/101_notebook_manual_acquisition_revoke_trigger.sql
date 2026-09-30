-- Migration 101: an identity change turns off manuals an automatic search
-- enabled for the OLD identity — in the SAME transaction (#4075, Codex #4118 r3 F3).
--
-- Migration 100 added equipment_notebooks.manual_acquisition. The background
-- search (src/capabilities/notebook-manual-acquisition.ts) enables a manual only
-- when the document's own text verifies it, and stamps the search key into the
-- source's match_evidence as "autoAcquisitionKey". If the technician then
-- corrects the notebook's identity, that manual must stop answering for the new
-- machine. Doing it from the route AFTER the identity commit left a window (and a
-- permanent gap on a crash between the two transactions); a trigger makes the
-- revocation part of the identity write itself, on every write path.
--
-- The key is the SQL twin of acquisitionKey() in that module:
--   upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) for manufacturer|model|catalog.
-- Only sources carrying autoAcquisitionKey are touched; manuals a technician
-- attached or confirmed are never affected. Revoked sources stay attached as
-- candidates the technician can review.
--
-- Runs as the invoking role (factorylm_app already has UPDATE on
-- equipment_notebook_sources, migration 073). Idempotent.

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
     AND s.match_evidence->>'autoAcquisitionKey' IS NOT NULL
     AND (NEW.identity_status <> 'user_confirmed' OR s.match_evidence->>'autoAcquisitionKey' <> new_key);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS equipment_notebooks_revoke_auto_manuals ON equipment_notebooks;
CREATE TRIGGER equipment_notebooks_revoke_auto_manuals
  AFTER UPDATE OF manufacturer, model, catalog_number, identity_status ON equipment_notebooks
  FOR EACH ROW
  WHEN (OLD.manufacturer IS DISTINCT FROM NEW.manufacturer
     OR OLD.model IS DISTINCT FROM NEW.model
     OR OLD.catalog_number IS DISTINCT FROM NEW.catalog_number
     OR OLD.identity_status IS DISTINCT FROM NEW.identity_status)
  EXECUTE FUNCTION revoke_stale_auto_acquired_manuals();

COMMIT;
