# Troubleshooting

Common issues and fixes, organized by symptom. If yours isn't listed, email [support@factorylm.com](mailto:support@factorylm.com).

## Login and signup

### "I signed up but never got the welcome email"

- Check your spam folder (search for `factorylm.com`)
- The welcome email is sent from `hello@factorylm.com`; allowlist this address in your email client
- If it's been more than 10 minutes and still nothing, email support — we can manually resend

### "The checkout link expired"

Stripe checkout sessions expire after 24 hours. Reply to the payment email and we'll generate a new link.

### "I forgot my password" / "How do I log in?"

MIRA uses magic-link login — no passwords. On the login page, enter your email; MIRA emails you a one-time login link that's valid for 10 minutes.

## Chat and diagnostics

### "MIRA is giving generic answers that don't match my equipment"

The most common cause is missing asset context. Three fixes, in order of effort:

1. **Mention the specific machine at the start of your message** — e.g., *"On my Yaskawa GS20 VFD at Line 3..."* MIRA will scope subsequent responses to that asset.
2. **Upload a photo of the nameplate** — MIRA reads vendor/model via vision.
3. **Set up QR asset tagging** ([QR asset tagging](qr-system.md)) so scans automatically scope every conversation.

### "MIRA cited a manual I never uploaded"

MIRA ships with a shared knowledge base covering 100+ common vendors. If MIRA's answer is accurate, that's working as designed.

If you want MIRA to prefer your specific plant's manual variant, upload it via **Knowledge → Upload PDF**. Your uploads are weighted higher than the shared knowledge base for your tenant.

### "MIRA said something dangerous / unsafe"

Report it immediately — **Report → Safety concern** button on every message, or email [safety@factorylm.com](mailto:safety@factorylm.com) with screenshots. We review safety reports within 24 hours and tune the guardrails accordingly.

MIRA has built-in safety guardrails (arc flash, LOTO, confined space, etc. — 21 phrase-level triggers) that force a stop-and-reassess response on keyword hit. We are always improving these; your reports are the highest-priority signal.

### "MIRA is slow / responses take forever"

- First message in a conversation is slower (3–8 seconds) while the model warms up and retrieves context
- Subsequent messages should stream within ~1 second
- If responses consistently take >15 seconds, check [status.factorylm.com](https://status.factorylm.com) or email support

## QR scanning

### "The QR sticker won't scan"

- Clean the sticker (wipe off grease / dust with a dry cloth)
- Check the lighting — direct sunlight or very low light can confuse the camera
- Try holding the phone 6–12 inches from the sticker
- If the sticker is physically damaged, log in to the admin page and reprint it

### "The scan opens the wrong asset"

- First scan on a fresh sticker: verify the asset tag printed on the sticker matches what MIRA says
- If they don't match, the sticker was misprinted or mis-stuck. Reprint via the admin page.

### "The scan takes me to a login page, then to an empty chat"

Known issue on fresh devices — the login redirect sometimes loses the asset context. Workaround: after logging in, scan the QR again. Fix is tracked in the QR system spec (§12.1) and shipping in the first production release.

## CMMS integration

### "MIRA can't see my work orders"

- Confirm your CMMS is connected: **Settings → CMMS → Status** should show a green "Connected."
- If red, the API key may have expired or been revoked. Regenerate in your CMMS, paste into MIRA, confirm.
- Some CMMS platforms have per-user permissions; ensure the API key's user has read access to work orders for your plant.

### "MIRA created a duplicate work order"

Tap the duplicate WO in your CMMS and delete it. To prevent recurrence, when MIRA proposes a WO draft, check the "Existing similar WOs" panel before confirming.

## Still stuck?

- **Email:** [support@factorylm.com](mailto:support@factorylm.com)
- **Response time during beta:** <24 hours
- **Emergency (safety-related):** [safety@factorylm.com](mailto:safety@factorylm.com) — <2 hour response
