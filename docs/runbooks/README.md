# docs/runbooks/ — Operational Procedures

Step-by-step procedures. Each has **Prerequisites · Steps (exact commands) · Expected output · What can go wrong**. Run the runbook; don't improvise.

## Core ops (comprehensive set, 2026-06-07)

| Runbook | When to use |
|---|---|
| [deploy-to-production.md](deploy-to-production.md) | Ship merged code to the VPS; watch the deploy; hotfix bypass |
| [vps-health-check.md](vps-health-check.md) | Check all containers, disk, memory, swap on the VPS |
| [merge-prs.md](merge-prs.md) | Merge a PR safely (staging gate, required checks, auto-merge disabled) |
| [apply-migrations.md](apply-migrations.md) | dev → staging → prod migration workflow (the two migration dirs) |
| [fix-hub-502.md](fix-hub-502.md) | app.factorylm.com returns 502 — diagnose crashed vs removed vs OOM |
| [fix-hub-container-removed.md](fix-hub-container-removed.md) | The recurring "Hub container was *removed*" case (self-healer can't fix it) |
| [provision-ignition-hmac.md](provision-ignition-hmac.md) | Set up `MIRA_IGNITION_HMAC_KEY` for Ignition cloud chat |
| [reset-ignition-trial.md](reset-ignition-trial.md) | Reset the Perspective trial on the PLC laptop |
| [upload-manual-verify-citable.md](upload-manual-verify-citable.md) | Upload a PDF and verify it's actually retrievable in chat |
| [seed-demo-data.md](seed-demo-data.md) | Seed the demo tenant for video recording |
| [run-eval-suite.md](run-eval-suite.md) | Run the offline eval and interpret pass/fail |

## Other existing runbooks
`atlas-wo-outbox.md`, `cmms-onboarding.md`, `edge-deploy.md`, `factorylm-vps.md`, `plc-integration-test.md`, `sidecar-oem-migration.md`, `staging-environment.md`, `staging-vps.md`, `vps-hang-recovery.md`, `hud-demo-setup.md`, plus dated event runbooks (florida-expo, etc.).

**See also:** [../architecture/environment-quick-ref.md](../architecture/environment-quick-ref.md) and [../environments.md](../environments.md) (authoritative env doctrine).

## HubV3 HITL acceptance testing (2026-06-27)

| Runbook | Purpose |
|---|---|
| [hubv3-human-in-the-loop-testing.md](hubv3-human-in-the-loop-testing.md) | 11-step witness procedure for PRD §6 Test 12 (Garage Conveyor demo) |
| [hubv3-hitl-agent-preflight-report.md](hubv3-hitl-agent-preflight-report.md) | Agent pre-flight report (Steps 1–5 automated, 2026-06-26) |
| [hubv3-hitl-sign-off.md](hubv3-hitl-sign-off.md) | Sign-off report — all 12 MUST boxes pass (2026-06-27) |
