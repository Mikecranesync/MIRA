# Prod Smoke — After the First OVH Dispatch

**Created:** 2026-09-19 · **Owner:** CHARLIE-A runs this · **Author:** BRAVO-B (PRD #3857 lane)
**Scope:** Production only — `factorylm.com` + `app.factorylm.com` on OVH `40.160.141.61`.

## When to run

Immediately **after Mike's first `deploy-vps.yml` dispatch to OVH** (the dispatch itself
is Mike's decision, gated on #3825 merging). This is the gate before declaring prod
healthy. Do **not** run it against the dead DigitalOcean box `165.245.138.91` — that host
is decommissioned. Staging's new home is a separate, still-open question (see #3825
follow-ups); this plan does not cover staging.

## 1. Public reachability (run from anywhere)

These mirror the checks in `.github/workflows/smoke-test.yml` (the deploy gate). Expected
codes are what a healthy prod returns; a `502/503/504` means nginx has no upstream — wait
60–90s for containers to come up, then re-check before escalating (see issue #3598).

```bash
# Marketing site — expect 200
curl -sS -o /dev/null -w 'factorylm.com/          -> %{http_code}\n' https://factorylm.com/
curl -sS -o /dev/null -w 'factorylm.com/pricing   -> %{http_code}\n' https://factorylm.com/pricing
curl -sS -o /dev/null -w 'factorylm.com/cmms      -> %{http_code}\n' https://factorylm.com/cmms

# Hub — unauthenticated root redirects to /login; expect 200 (follow) or 3xx (no-follow)
curl -sS -o /dev/null -w 'app.factorylm.com/ (no-follow) -> %{http_code} redirect=%{redirect_url}\n' https://app.factorylm.com/
curl -sSL -o /dev/null -w 'app.factorylm.com/ (follow)   -> %{http_code}\n'                          https://app.factorylm.com/
```

**Expected:** `factorylm.com/`, `/pricing`, `/cmms` → `200`. `app.factorylm.com/` → `200`
when following redirects (lands on the `/login` page), or a `3xx` to `/login` when not
following. Anything `5xx` = fail.

## 2. TLS validity (run from anywhere)

```bash
for host in factorylm.com app.factorylm.com; do
  echo "== $host =="
  curl -sS -o /dev/null -w 'tls=%{http_version} code=%{http_code} sslverify=%{ssl_verify_result}\n' "https://$host/"
done
```

**Expected:** `sslverify=0` (cert valid) for both. Non-zero = TLS/cert problem.

## 3. On-box service health (CHARLIE-A, via SSH to the OVH host)

These mirror the post-deploy checks `deploy-vps.yml` already runs on the box. Run them on
the OVH prod host once SSH access is confirmed (SSH alias / key path for OVH is a
cutover item — verify before relying on the alias).

```bash
# Pipeline (chat backend)
curl -sf http://localhost:9099/health && echo " pipeline OK" || echo " pipeline UNREACHABLE"

# Hub API — deploy-vps.yml probes either path
curl -sf -o /dev/null -w 'hub /api/health -> %{http_code}\n'     http://127.0.0.1:3101/api/health \
  || curl -sf -o /dev/null -w 'hub /hub/api/health -> %{http_code}\n' http://127.0.0.1:3101/hub/api/health
```

**Expected:** pipeline `/health` returns JSON with `status` present; hub returns `200` on
one of the two paths.

## Pass / Fail

- **PASS:** §1 public checks all green (200 / login-redirect), §2 TLS valid, §3 on-box
  services reachable.
- **FAIL:** any `5xx` on §1 after the 60–90s upstream warmup, TLS verify failure, or an
  unreachable on-box service. Do not declare prod healthy.

## Rollback

If smoke fails and the cause is the new deploy, follow `docs/runbooks/hubv3-rollback.md`.

## Notes / open cutover items

- The public health path for the hub is the **`/login` redirect on `app.factorylm.com/`**,
  not a public `/api/health` — the `*/api/health` endpoints are **internal** (on-box) only.
- SSH alias, key path, and provider/spec details for the OVH host are **not yet verified**
  in the repo and are tracked as cutover items in the #3825 follow-up PR. Confirm them
  before running §3.
