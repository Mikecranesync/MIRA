---
name: ignition-webdev
description: Use when adding or editing MIRA's Ignition WebDev endpoints, gateway scripts, Perspective views, tag allowlist, or any file under ignition/ in the MIRA monorepo — covers the config-as-files deploy procedure, the tag allowlist, secrets, and validation.
---

# Ignition WebDev / resource development (MIRA monorepo)

Use this when touching anything under `ignition/` in MIRA-monorepo. Full context:
`docs/agent-workflows/ignition-resource-development.md` and `docs/ignition-8.3-alignment-plan.md`.

## When this applies
- Editing `ignition/webdev/FactoryLM/api/<name>/{doGet,doPost}.py` (Jython 2.7 HTTP handlers)
- Editing `ignition/gateway-scripts/*.py` (Jython tag-change / timer scripts)
- Editing Perspective `view.json` / `resource.json` under `ignition/project/...perspective/views/`
- Editing `ignition/project/approved_tags.json` (the read allowlist) or `ignition/tags/*.json`

## Hard rules (do not violate)
1. **Never deploy via the Gateway web-UI Project Import** — it corrupts 8.3.x projects. Deploy is
   stop-service → write files → start-service. (See `MIRA_PLC/.claude/skills/ignition-dashboard`.)
2. **Reads are allowlisted, fail-closed.** A tag MIRA reads must be in `approved_tags.json` or the
   WebDev tags endpoint returns 503. The allowlist loader is `ignition/webdev/FactoryLM/api/tags/allowlist.py`;
   its repo-dev fallback path is `ignition/project/approved_tags.json`.
3. **No secrets in files.** Never commit a literal or empty key (e.g. `X-Mira-Key:""`) in a view or
   script. Use `system.secret.get('MIRA_IGNITION_HMAC_KEY')` with a `factorylm.properties` fallback.
4. **Jython 2.7, not Python 3.** WebDev/gateway scripts run in Jython — no f-strings beyond 2.7, no
   `httpx`; prefer `system.net.httpGet/httpPost` and `system.util.jsonEncode/jsonDecode`.
5. **HMAC-sign cloud-bound POSTs** using `ignition/webdev/FactoryLM/api/chat/signing.py` (matches the
   verifier in `mira-pipeline/ignition_chat.py`).

## Validate before you finish (checklist)
- [ ] `python -m json.tool <each changed .json>` exits 0
- [ ] Perspective view: both `resource.json` (metadata) and `view.json` (content) present + valid
- [ ] Allowlist still resolves: `allowlist.resolve_allowlist_path()` returns a real path
- [ ] If a handler/script changed: `tests/regime7_ignition/` and `tests/ignition/` pass
- [ ] No secret literals; no web-UI-Import instructions added to docs

## Common gotchas
| Symptom | Cause | Fix |
|---------|-------|-----|
| Tags endpoint returns 503 | tag not in `approved_tags.json` | add the exact `[provider]path` |
| AskMira reads return null quality | script provider/folder ≠ deployed tag folder (e.g. `MIRA_IOCheck` vs `[MIRA_PLC]`) | match the folder name or parameterize it |
| View edit doesn't show after copy | `resource.json` timestamp not bumped | update `attributes.lastModification.timestamp`, restart service |
| Project corrupted (files→dirs) | used web-UI Project Import | restore from `_import_stage` / `RESTORE_PROJECT.ps1`; never import via web UI |
