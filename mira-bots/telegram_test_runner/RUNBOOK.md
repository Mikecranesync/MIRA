# MIRA Telegram Vision Test Harness — Runbook

## 1. Prerequisites

- `mira-bot-telegram` container healthy: `docker compose ps`
- Telegram bot token configured in `.env`
- Docker Compose v2 installed
- Test environment variables set (see `.env.example`)

## 2. One-Time Setup — Get API Credentials

1. Go to [my.telegram.org](https://my.telegram.org) and log in with your personal Telegram account
2. Click **API development tools**
3. Create an app (any name/platform) — you'll get `api_id` (integer) and `api_hash` (string)
4. Add to your `.env`:
   ```
   TELEGRAM_TEST_API_ID=12345678
   TELEGRAM_TEST_API_HASH=your_api_hash_here
   TELEGRAM_TEST_PHONE=+15551234567
   TELEGRAM_BOT_USERNAME=@YourMIRABot
   ```

## 3. One-Time Setup — Authenticate Telethon Session

The session must be created interactively once. Telethon will prompt for your phone code (and 2FA password if enabled).

```bash
cd ~/Mira/mira-bots
docker compose --profile test run -it --entrypoint python telegram-test-runner session_setup.py
```

Follow the prompts. The session is saved to the `telegram_test_session` Docker volume and persists across runs.

## 4. Run All Tests

```bash
cd ~/Mira/mira-bots
docker compose --profile test run --rm telegram-test-runner --all
```

Exit code 0 = all pass. Exit code 1 = any failure.

## 5. Run One Test

```bash
docker compose --profile test run --rm telegram-test-runner --case ab_micro820_tag
```

## 6. Dry Run (No Telegram Required)

Validates scoring logic and report generation without any network activity:

```bash
docker compose --profile test run --rm telegram-test-runner --all --dry-run
```

All cases will show `TRANSPORT_FAILURE` — this is expected. Check `artifacts/latest_run/report.md`.

## 7. Reading the Report

Reports are written to `mira-bots/artifacts/latest_run/`:

- `results.json` — machine-readable, full detail
- `report.md` — human-readable with fix suggestions

## 8. Failure Bucket Glossary

| Bucket | Meaning | First Fix |
|--------|---------|-----------|
| `TRANSPORT_FAILURE` | Bot never replied | Check bot container health, token validity |
| `OCR_FAILURE` | Make/model not found in reply | Better photo quality, tighter crop |
| `REASONING_WEAK` | Make found, model/catalog missing | Strengthen system prompt for catalog extraction |
| `RESPONSE_TOO_GENERIC` | Fields found but reply lacks useful detail | Add structured response template to system prompt |
| `HALLUCINATION` | Reply contains wrong brand/component | Review vision model confidence, add grounding instructions |
| `ADVERSARIAL_PARTIAL` | Partial pass on degraded image (expected) | Monitor for regression vs baseline score |
