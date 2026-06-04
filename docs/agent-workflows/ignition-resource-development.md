# Agent Workflow — Developing & PR-ing Ignition Resources

**Status:** ACTIVE · **Authored:** 2026-06-04 · Pairs with
[`../ignition-8.3-alignment-plan.md`](../ignition-8.3-alignment-plan.md).

How an agent (or human) safely inspects, generates, validates, and PRs Ignition 8.3 resources in this
repo. Ignition 8.3 stores Gateway resources as files, so they version-control and review like code —
**if** you follow the layout and deploy rules below.

---

## Where Ignition resources live

| Resource | Path | Format |
|----------|------|--------|
| Perspective views | `ignition/project/com.inductiveautomation.perspective/views/<View>/` | `resource.json` (metadata) **+** `view.json` (content) |
| Page routes | `ignition/project/com.inductiveautomation.perspective/page-config/config.json` | JSON URL→view map |
| WebDev endpoints | `ignition/webdev/FactoryLM/api/<name>/{doGet,doPost}.py` | Jython 2.7 |
| Gateway event scripts | `ignition/gateway-scripts/*.py` | Jython 2.7 |
| Tag definitions | `ignition/tags/*.json`, `MIRA_PLC/ignition/**/tag-definition/**/tags.json` | JSON tag arrays |
| Tag read allowlist | `ignition/project/approved_tags.json` | JSON `{version, description, tags:[...]}` |
| Config template | `ignition/config/factorylm.properties.template` | properties |
| Deploy scripts | `ignition/deploy_ignition.ps1`, `MIRA_PLC/ignition/ConvSimpleLive/APPLY*.ps1` | PowerShell |

**Correct view layout (8.3):** `resource.json` holds *metadata only*
(`{scope, version, restricted, overridable, files:["view.json"], attributes.lastModification}`);
`view.json` holds the component tree. The `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/` pair is the
reference. (Several monorepo views still embed content in `resource.json` — a Phase 1 cleanup.)

---

## The golden rules

1. **Never use the Gateway web-UI "Project Import."** On 8.3.x it corrupts the project (resource files
   become directories). Deploy by **stop service → write files → start service** (see below). This is
   codified in `MIRA_PLC/.claude/skills/ignition-dashboard/SKILL.md`.
2. **Read-only by default.** Reads go through the fail-closed allowlist (`approved_tags.json`). Adding a
   write (`system.tag.writeBlocking`) requires an explicit Security Level gate and a reviewer.
3. **No secrets in resources.** Never put a literal or empty credential in `view.json`, a script, or a
   doc. Use `system.secret.get('MIRA_IGNITION_HMAC_KEY')`.
4. **Validate before deploy.** `python -m json.tool <file>.json` must pass for every `view.json` /
   `resource.json` / `tags.json` you touch. (Phase 2 makes this a CI gate.)
5. **One render per change.** Keep a `rollbacks/` snapshot + PNG per significant view version (the
   `MIRA_PLC/ignition/ConvSimpleLive/rollbacks/` pattern) so a regression is one copy away from undone.

---

## The deploy procedure (existing Perspective view edits)

```powershell
# Reference: MIRA_PLC/ignition/ConvSimpleLive/APPLY_ASKMIRA.ps1
Stop-Service Ignition
Copy-Item <repo>\ignition\...\view.json  <gateway>\data\projects\<proj>\...\view.json
# bump resource.json attributes.lastModification.timestamp so the gateway reloads it
Start-Service Ignition
# verify: open /data/perspective/client/<proj>, confirm the change rendered
```

Config-only resources (tags, properties) can be hot-applied without a service stop; **Perspective views
cannot** — they require the stop-write-start cycle.

---

## How an agent should open an Ignition PR

1. **Branch** off `main`: `feat/ignition-<short-topic>` (resources) or `docs/ignition-<topic>` (docs).
2. **Separate generated from hand-edited.** Agent-generated resources (e.g. a synthesized view) go in
   `ignition/starter-project/` or a clearly-labeled generated path; never silently overwrite a
   hand-tuned bench view. Hand edits to live bench views (`MIRA_PLC/ignition/ConvSimpleLive/`) are
   explicit and reviewed.
3. **Validate locally:** `python -m json.tool` on every JSON touched; if a WebDev/script changed, run
   `tests/regime7_ignition/` and `tests/ignition/`.
4. **Keep PRs small + foundational.** Docs/scaffold PRs don't touch live gateways. A view-changing PR
   should land *after* the JSON-lint CI gate exists (Phase 2) and carry a `RESTORE_PROJECT.ps1` rollback note.
5. **PR description must state:** which gateway (bench `100.72.2.99` vs customer), whether it was deployed
   + verified or is file-only, and that no secrets/no web-UI-Import were used.
6. **Resource changes that touch a running gateway are proposals**, not direct writes, once the Phase 5
   approval pipeline exists — route through `mira-hub` /proposals.

---

## Quick reference — validate everything an agent touched

```bash
# JSON syntax (run on every changed .json under ignition/)
git diff --name-only --diff-filter=d main... | grep -E 'ignition/.*\.(json)$' \
  | while read f; do python -m json.tool "$f" >/dev/null && echo "ok  $f" || echo "BAD $f"; done

# allowlist still loads
python -c "import sys; sys.path.insert(0,'ignition/webdev/FactoryLM/api/tags'); \
  import allowlist; print('allowlist path:', allowlist.resolve_allowlist_path())"
```
