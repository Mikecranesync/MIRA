# Governed Together Cloud Exception

Date: 2026-07-23

This document records the narrow interpretation that permits the existing FactoryLM AI Together workstream despite the repository-root "No cloud except..." rule. The global rule remains in force for MIRA generally; this exception does not authorize unrelated cloud providers, deployments, background jobs, or production traffic.

## Allowed Scope

Allowed only under `factorylm_ai.providers.together` and related `factorylm_ai.finetune` governance code:

- `POST /fine-tunes/estimate-price` for zero-spend price evidence tied to a versioned canonical request hash.
- `POST /fine-tunes` only after the paid gate passes, the Together estimate receipt matches the canonical request hash, and a trusted paid authorization is atomically consumed.
- Temporary dedicated endpoint create/get/delete only for authorized benchmark bursts, with `inactive_timeout`, immediate endpoint lease ownership, verified or recorded cleanup, and idempotent orphan cleanup.
- Fine-tune status/events/checkpoint/download reads for already-governed jobs and artifacts.
- Local dry-run, canonicalization, pricing, receipt verification, and hermetic tests.

## Explicitly Not Allowed

- No implicit paid execution.
- No Together upload, fine-tune job, endpoint creation, endpoint benchmark, or spend without explicit human approval and the trusted paid-authorization flow.
- No unrelated Together services outside this workstream.
- No unrelated cloud providers.
- No production deployment or VPS/container operation.
- No API keys, bearer tokens, private signing keys, or secrets committed to git.

## Authorization Boundary

Paid Together actions require:

- a versioned canonical request hash;
- a Together estimate receipt bound to that hash when fine-tuning;
- a trusted stored authorization receipt bound to provider, action, request hash, spend cap, currency, issuer, authority reference, issued time, and expiration;
- atomic single-use consumption before the paid HTTP request;
- append-only audit evidence with no secret material.

Authorization IDs are never reused for new approvals. Persisting the exact same
active authorization receipt again is an idempotent no-op for retry safety; a
changed receipt or any reauthorization attempt after `consumed` or `revoked` is
rejected and must use a new `authorization_id`.

If the trusted verifier or ledger is unavailable, the action fails closed.
