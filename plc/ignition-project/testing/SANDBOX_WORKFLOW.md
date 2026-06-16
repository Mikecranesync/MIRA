# Ignition Sandbox Workflow — experiment safely, then promote

After the 2026-06-14 native-trend deploy rendered blank + broke the header on the **live**
ConvSimpleLive project, we now experiment in an isolated **sandbox** first.

## The two safety layers

1. **GitHub save point.** Every working state is pushed to `origin` and the last known-good is
   tagged. Current safe point: tag **`convsimplelive-known-good-2026-06-14`** (markdown Maintenance
   panel + :8766 trend, no nav bar/native chart). Roll the *repo* back anytime with
   `git checkout convsimplelive-known-good-2026-06-14 -- plc/ignition-project/ConvSimpleLive`, and the
   *live gateway* with `rollback/ROLLBACK.ps1`.
2. **Sandbox project.** A standalone Perspective project named **`testing`** on the same gateway.
   It sees the same live tags and the same `mira_diagnose` script library, but **nothing in it can
   change the live ConvSimpleLive project**. Experimental views go here first.

## The loop

```
 build view in repo ──▶ DEPLOY_TESTING.ps1 ──▶ live-test at /testing ──▶ approve ──▶ PROMOTE.ps1 ──▶ commit
        (repo)            (elevated)              (browser)                          (elevated)        (git)
```

1. **Build** the experimental view in `plc/ignition-project/testing/com.inductiveautomation.perspective/views/<Name>/`
   (`view.json` + `resource.json`), and add a route for it in
   `…/testing/com.inductiveautomation.perspective/page-config/config.json`.
2. **Deploy to the sandbox:** run `DEPLOY_TESTING.ps1` as Administrator. It rebuilds the `testing`
   project fresh from the repo and pulls `mira_diagnose` from ConvSimpleLive so `runScript` works.
   Open `http://localhost:8088/data/perspective/client/testing/<route>`.
3. **Live-test.** Induce faults, run the conveyor, check the look. The live ConvSimpleLive project is
   untouched the whole time — if the experiment is blank/broken, only the sandbox is.
4. **Promote when approved:** `PROMOTE.ps1 -View <Name>` (as Administrator) copies the view into the
   live ConvSimpleLive project **and** the repo. Then `git add/commit` the repo view, and add a page
   route to ConvSimpleLive's `page-config/config.json` if the view needs its own URL.

## Notes / limits

- **Shared gateway.** Both projects live on one Ignition gateway, so `DEPLOY_TESTING.ps1` and
  `PROMOTE.ps1` stop/start the service (~30 s) — that briefly restarts the live project too. The
  *isolation* is at the project/resource level (bad views never land in live), not a separate server.
- **The sandbox is disposable.** `DEPLOY_TESTING.ps1` rebuilds `testing` from the repo each run, so
  the repo is the source of truth. Don't hand-edit the gateway `testing` project expecting it to
  persist — put changes in the repo.
- **Tags + history are gateway-global.** The sandbox reads the same `[default]MIRA_IOCheck/...` tags.
  If an experiment needs tag history, enable it once on the gateway (it then applies everywhere).
- **Always works because** `mira_diagnose` is pulled from ConvSimpleLive at deploy time — keep that
  the single source of the rule logic.

## Files

- `project.json` — the standalone testing project.
- `com.inductiveautomation.perspective/` — page-config + `Sandbox` landing view (+ your experiments).
- `DEPLOY_TESTING.ps1` — (re)build the sandbox on the gateway.
- `PROMOTE.ps1 -View <Name>` — promote an approved view to live + repo.
- `../ConvSimpleLive/rollback/ROLLBACK.ps1` — revert the live project to the last known-good.
