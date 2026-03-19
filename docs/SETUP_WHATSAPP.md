# MIRA — WhatsApp Setup Guide

## Overview

MIRA integrates with WhatsApp via the Twilio WhatsApp Sandbox. Technicians send equipment photos and text to the MIRA WhatsApp number and receive diagnostic responses.

## Prerequisites

- Twilio account (free trial works for sandbox)
- A publicly accessible domain or ngrok tunnel for the webhook
- Doppler CLI configured for `factorylm/prd`

## Setup Steps (~10 minutes)

### 1. Create Twilio Account

1. Sign up at [twilio.com](https://twilio.com)
2. From the Console Dashboard, note your **Account SID** and **Auth Token**

### 2. Activate WhatsApp Sandbox

1. In Twilio Console → **Messaging** → **Try it out** → **Send a WhatsApp message**
2. Follow the instructions to join the sandbox (send a WhatsApp message to the sandbox number)
3. Note the **sandbox WhatsApp number** (format: `+1415XXXXXXX`)

### 3. Set Secrets in Doppler

```bash
doppler secrets set \
  TWILIO_ACCOUNT_SID=<your-account-sid> \
  TWILIO_AUTH_TOKEN=<your-auth-token> \
  TWILIO_WHATSAPP_FROM=whatsapp:+1415XXXXXXX \
  --project factorylm --config prd
```

### 4. Set Webhook URL

1. In Twilio Console → **Messaging** → **Settings** → **WhatsApp Sandbox settings**
2. Set **When a message comes in:**
   ```
   https://<your-domain>:8010/webhook
   ```
   Method: `HTTP POST`
3. If testing locally: use `ngrok http 8010` and set the ngrok URL

### 5. Deploy the WhatsApp Bot

```bash
doppler run --project factorylm --config prd -- \
  docker compose up -d whatsapp-bot
```

### 6. Test

Send a WhatsApp message (text or photo) to the sandbox number from a phone that has joined the sandbox. MIRA should respond within 10 seconds.

## Verify

```bash
curl http://localhost:8010/health
# Expected: {"status": "ok", "platform": "whatsapp"}
```

## Environment Variables

| Var | Description |
|-----|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (Doppler) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token (Doppler) |
| `TWILIO_WHATSAPP_FROM` | Sandbox WhatsApp number, e.g. `whatsapp:+14155238886` (Doppler) |
| `WHATSAPP_PORT` | Host port (default: 8010) |
| `TWILIO_VALIDATE_SIGNATURE` | Set to `false` for local dev without ngrok (default: `true`) |

## Moving to Production WhatsApp

The Twilio Sandbox is for development only. For production:

1. Apply for a WhatsApp Business Account via Twilio
2. Get a dedicated WhatsApp Business number
3. Update `TWILIO_WHATSAPP_FROM` in Doppler to the production number
4. Update the webhook URL to your production domain

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No response | Check webhook URL in Twilio console + ngrok is running |
| 403 Forbidden | Signature validation failed — check TWILIO_AUTH_TOKEN matches |
| Media not downloading | Ensure TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are correct |
