# Print of the Day — staging activation runbook (ADR-0031 PR 7)

**Status:** staging-only. **No production activation.** Owner-budget-capped live E2E.
**Depends on:** PR 6 (#2866, containerized POTD) merged or checked out.

This runbook flips **staging** to the Together/MiniMax operational default and runs one
budget-capped live end-to-end proof. It changes no production configuration and merges no code
into an activation path — the artifact of PR 7 is this runbook plus the captured evidence report
(`docs/benchmarks/2026-07-21-potd-staging-e2e.md`).

## Staging operational config (Doppler `factorylm/stg`, agent-allowed)

```
PRINT_VISION_PROVIDER=together
PRINT_VISION_MODEL=MiniMaxAI/MiniMax-M3
PRINT_PROVIDER_POLICY=strict
OCR_REQUIRE_TESSERACT=1
FACTORYLM_NETWORK_MODE=enabled
```

Production (`factorylm/prd`) is UNCHANGED — it stays on its prior provider default until a
separate, owner-approved PR 8 activation. Rollback is a single env flip
(`PRINT_VISION_PROVIDER=openai|anthropic`) that preserves the registry, readiness, OCR
enforcement, and provenance (ADR-0031 §12).

## Build the pinned container (records the revision)

```bash
SHA=$(git rev-parse HEAD)
docker build -f tools/print_of_day/Dockerfile \
  --build-arg GIT_SHA=$SHA --build-arg VERSION=$(cat VERSION) \
  --label org.opencontainers.image.revision=$SHA \
  -t mira-print-of-day:$SHA .
```

The image bakes `IMAGE_REVISION=$SHA` (OCI label + env). The provenance gate refuses to run if
the running code disagrees with the image revision (`REVISION_MISMATCH`).

## Budget-capped live E2E

`tools/print_of_day/staging_e2e.py` drives the proof with a **hard USD ceiling** (default `0.50`,
`--budget-usd`). It:

1. asserts the image revision label == the requested SHA (`correct deployed container revision`),
2. runs the container's readiness `--live` (known-token vision canary + Tesseract),
3. runs one real POTD case (blind interpret → grade → judge → manifest),
4. sends **exactly one** gated email,
5. runs the case a second time to prove duplicate delivery is blocked ($0 — blocked before interpret),
6. sums the recorded token usage against the ceiling and ABORTS if exceeded.

```bash
doppler run -p factorylm -c stg -- python tools/print_of_day/staging_e2e.py \
  --image <print.png> --recipient <you@example.com> --budget-usd 0.50
```

The E2E is manual and owner-permissioned; it is not wired into any scheduled workflow in PR 7.

## Evidence

The run writes `docs/benchmarks/2026-07-21-potd-staging-e2e.md` with: exact external calls + spend,
requested vs returned model identity, image revision + git SHA, tesseract version, grader + judge
state, the email send id, and the duplicate-block proof. See that file for the actual run.
