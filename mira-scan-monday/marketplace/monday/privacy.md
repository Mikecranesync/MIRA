# MIRA Scan — Privacy and Data Flow

This document tells you exactly what data leaves your monday.com workspace, where it goes, and how long it lives. Updated 2026-05-05.

## Tl;dr

- The phone-captured image goes to **OpenAI Vision** for extraction, then is dropped on our side.
- Extracted equipment specs (make, model, serial, etc.) go into MIRA's **NeonDB knowledge base** — this is intentional, it's how the cooperative gets smarter.
- Chat messages go through **MIRA's LLM cascade** (Groq, Cerebras, Google Gemini), all free-tier with no training-on-input.
- Your monday account id and OAuth token live in NeonDB, scoped to YOUR install.
- We do **not** capture user emails, names, board contents beyond the in-flight column write, or any end-user PII.

## Data flows in detail

### 1. Phone camera image → vision extraction

When you tap **Scan plate**:
- The browser captures an image (resized client-side to ≤1280px on the long edge).
- The base64-encoded image is POSTed to MIRA Scan's backend at `app.factorylm.com/scan-api/scan/extract`.
- The backend forwards the image to **OpenAI's Vision API** (`gpt-4o`).
- OpenAI returns structured JSON (make, model, serial, voltage, HP, RPM, frame, confidence).
- **MIRA does not persist the image bytes.** They live in memory for the duration of the API call and are discarded.
- OpenAI's data-use policy (effective 2024) applies: API inputs are not used for training; abuse-monitoring retention is 30 days. See <https://openai.com/policies/api-data-usage-policies>.

### 2. Extracted specs → MIRA knowledge base

The structured fields (make, model, etc.) are:
- Returned to your iframe for display in the AssetCard.
- Used to look up matching content in MIRA's `kb_chunks` knowledge base.
- **If MIRA doesn't yet have the manual:** the (make, model) pair is enqueued in `mira_scan_queue` along with your monday account id, so we know which install surfaced the gap. We then trigger a real-time web search for the manufacturer's OEM PDF and queue it for ingest into the shared KB.
- **The shared KB is a feature, not a bug.** Per MIRA's North Star (`NORTH_STAR.md`), the more plants that scan, the more complete the manual coverage gets for everyone — that's the cooperative's value.

What's **not** stored alongside the (make, model):
- Your board id, board name, or any other monday board metadata
- The image itself
- Per-asset notes or comments from your team

### 3. Chat messages → MIRA's LLM cascade

When you ask a question in the chat panel:
- The message + the matched OEM manual chunks go to MIRA's pipeline at `mira-pipeline:9099`.
- Pipeline routes to **Groq → Cerebras → Google Gemini** (cascade, free-tier, all OpenAI-compatible).
- All three providers' free tiers explicitly do **not** train on submitted content.
- The chat reply is logged for ~30 days for incident triage; logs are not used for training.

### 4. Monday column writes → your board

When you click **Save to monday item**:
- The structured fields go to Monday's GraphQL API (`api.monday.com/v2`).
- Authenticated with the per-account OAuth token from your install.
- Monday writes the values into the columns your admin mapped (see `admin-guide.md`).
- This is a single round-trip — no intermediate storage.

## What MIRA stores per account, in NeonDB

| Table | Per-row data | Retention | Purpose |
|---|---|---|---|
| `monday_installations` | account_id, OAuth access_token, scope, user_id, install/last-seen timestamps | Lifetime of install (deleted on uninstall) | Per-account API auth |
| `mira_scan_queue` | make, model, your account_id, source, status, manual_url | 90 days; longer if the gap is still unfilled | Track which equipment needs manuals |
| `account_usage_daily` | account_id, usage_date, scan_count, last_seen_at | 13 months (rolling) | Billing-tier signal |

The NeonDB instance is hosted in AWS us-east-1, encrypted at rest (AES-256), and accessed only via TLS from our backend. No third party has read access.

## What MIRA does NOT capture

- **End-user emails or names.** We don't ask, and Monday's iframe doesn't expose them via the standard SDK we use.
- **Board contents beyond the in-flight write.** We don't read your board structure to "improve our service."
- **Image bytes.** Discarded after extraction.
- **Chat history beyond the active session.** No long-term per-user transcripts.

## Data subject rights

To request export or deletion of your account's data:
- **Email:** privacy@factorylm.com
- **Response SLA:** 30 days (typically <72 hours)

We delete on request without lecturing you about it.

## Security posture

- TLS only (HSTS enabled on `factorylm.com` and `app.factorylm.com`)
- OAuth tokens stored at rest in encrypted NeonDB; not encrypted at the application layer (industry-standard for SaaS marketplace apps)
- Per-account multi-tenant isolation in scan_queue and usage tables (Phase 1B)
- See `security-audit.md` for the self-audit + open items

## Compliance

- monday.com — SOC 2 Type II (their inheritance covers Monday-side data)
- AWS — SOC 2 Type II (NeonDB host)
- OpenAI — SOC 2 Type II (vision provider)
- Groq, Cerebras, Google Cloud — all SOC 2 (chat cascade)
- MIRA itself — not yet SOC 2 audited (small-team product). DPA available on request.

## Last updated

2026-05-05 — initial publication for monday.com marketplace submission.
