---
name: finish-capability
description: >-
  Use when a capability, feature, or flag-gated behaviour is about to be called
  done, shipped, or complete — and when adding a new gate flag. Trigger on "is
  this done", "ready to merge", "ship it", "turn it on", "enable in prod", or on
  adding any os.getenv("*_ENABLED"). Enforces that merged is not done:
  connected, tested by a named CI job, enabled somewhere real, proven with
  evidence — or explicitly blocked/deferred/retired in the registry.
---

# Finish a capability

> A capability is not done when its code is merged. It is done when it is
> **connected**, **tested**, **enabled somewhere real**, and **proven** — or when
> a documented decision explicitly blocks, defers, or retires it.

Registry: `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`
Validator: `python tools/capability_closure.py` (CI job `capability-closure`, gated)

## Why this exists

Three failures, all the same shape, all found in one audit:

- **Configured on, enforced off.** `MIRA_ENFORCE_APPROVED_RETRIEVAL` was `'true'`
  in Doppler prd and forwarded by **no** compose file, so the container read its
  `"false"` default. A security control that everyone believed was on (#3328).
- **Enabled but unproven.** The run-diff engine is enabled in production and its
  three test suites run in no CI job. Nobody has looked at a single diff.
- **Documented as absent while running.** Issue #2341 still says the run engine
  does not exist. It shipped months ago.

None of these is a coding error. Each is a capability that stopped at "merged".

## The seven questions

Answer all seven **before** reporting a capability complete. If you cannot answer
one, that is the finding — say so rather than filling it in.

1. **Capability and outcome** — what can a technician now do that they could not?
2. **Consumer** — what runtime surface actually calls it? A capability with no
   consumer is `implemented_unconnected`, however good the code is.
3. **Tests and the named CI job** — which job runs them? Check `ci.yml` by name:
   several suites here exist and run nowhere (#3089). Is that job in `ci-gate`'s
   `needs`? If not, it cannot fail a merge and is not a guard.
4. **Environment and flag state** — what is the flag, and what is it set to in
   dev/staging/prod? Read Doppler (`doppler secrets --project factorylm --config
   <env>`); the repository alone will mislead you, because a compose
   `${VAR:-0}` fallback looks identical to a real default.
5. **Evidence or blocker** — what artifact proves it works? "Enabled" is not
   "proven". No artifact ⇒ record a blocker, do not claim done.
6. **Rollback** — how is it turned off, and has that been checked?
7. **Registry** — update `CAPABILITY_CLOSURE.yaml` and run the validator.

## If you are enabling a flag

- **Verify the plumbing.** Setting it in Doppler is not enough: some
  `docker-compose*.yml` must forward it into the service whose code reads it.
  `check_enabled_flags_are_plumbed` catches this, but check before you claim.
- **Staging first, with a rollback path**, per `docs/environments.md`.
- **Never enable a safety-sensitive capability in production to satisfy a task.**
  If enablement needs human authorization, record the exact decision and evidence
  required — do not invent permission.

## If you are adding a new gate flag

Add it to `capabilities:` (a product capability) or `ignored_flags:` with a
reason (operational toggle, tuning value, eval-time switch). `--discover` fails
otherwise, so a flag cannot stay anonymous.

## Honest states

`implemented_unconnected` · `connected_ci_missing` · `deployed_disabled` ·
`staging_enabled` · `production_enabled` · `blocked` · `deferred` · `retired`

Do not record `production_enabled` without a Doppler observation, and do not
record evidence you have not looked at.
