/**
 * MIRA Magic Inbox — Google Apps Script poller
 *
 * Runs every minute on the owner's Google Workspace account. Looks for
 * unread email forwarded to kb+<slug>@factorylm.com (Gmail plus-addressing
 * routes these into the existing apex mailbox automatically — no DNS
 * changes, no subdomain MX, no new vendor).
 *
 * For each matched message: extracts attachments, base64-encodes them,
 * signs the JSON payload with HMAC-SHA256, POSTs to mira-web's webhook.
 * Marks read on success; leaves unread on failure (next run retries).
 *
 * Setup (~5 minutes, do once):
 *   1. Open https://script.google.com → New project
 *   2. Paste this entire file as Code.gs
 *   3. Click Project Settings (gear icon) → Script Properties → Add Property:
 *        HMAC_SECRET = <same value as INBOUND_HMAC_SECRET in mira-web Doppler>
 *   4. Triggers (clock icon) → Add Trigger:
 *        Function: processInbox
 *        Event source: Time-driven
 *        Type: Minutes timer
 *        Interval: Every minute
 *   5. Click Save → review the OAuth consent screen → Allow
 *   6. Done. Forward an email with a PDF to kb+<your-slug>@factorylm.com
 *      and watch mira-web logs for the receipt.
 *
 * Auth model: this script runs as the Workspace user who owns the project.
 *   Gmail scope (read) and UrlFetchApp scope are granted on first run.
 *   The HMAC secret is stored in Script Properties (encrypted at rest by
 *   Google) and never leaves the script.
 */

const WEBHOOK_URL = 'https://app.factorylm.com/api/v1/inbox/email';

// Match unread mail with kb+<slug> in any recipient field, last 24 h.
// `to:(kb+@)` matches To/Cc/Bcc; the `kb+@` substring is unique enough that
// false positives are essentially zero.
const SEARCH_QUERY = 'is:unread to:(kb+@) newer_than:1d';

// Cap per run so a backlog burst doesn't blow the 6-min execution limit.
const MAX_THREADS_PER_RUN = 10;

// Cap per attachment to match mira-ingest enforcement.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;


function processInbox() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('HMAC_SECRET');
  if (!secret) {
    Logger.log('FATAL: HMAC_SECRET not set in Script Properties — aborting.');
    return;
  }

  const threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);
  if (threads.length === 0) return;
  Logger.log('Found ' + threads.length + ' threads with unread kb+ messages');

  for (let t = 0; t < threads.length; t++) {
    const messages = threads[t].getMessages();
    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m];
      if (!msg.isUnread()) continue;
      try {
        const status = postMessageToWebhook(msg, secret);
        if (status >= 200 && status < 300) {
          msg.markRead();
        } else {
          Logger.log('webhook returned ' + status + ' for ' + msg.getId() +
                     ' — leaving unread for retry');
        }
      } catch (err) {
        Logger.log('Error processing ' + msg.getId() + ': ' + err);
        // leave unread — next run retries
      }
    }
  }
}


function postMessageToWebhook(msg, secret) {
  const attachments = msg.getAttachments({ includeInlineImages: false }).map(function (att) {
    const bytes = att.getBytes();
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      // Still send metadata so the webhook can categorize as too_large in the receipt.
      return {
        Name: att.getName(),
        Content: '',
        ContentType: att.getContentType() || '',
        ContentLength: bytes.length,
      };
    }
    return {
      Name: att.getName(),
      Content: Utilities.base64Encode(bytes),
      ContentType: att.getContentType() || '',
      ContentLength: bytes.length,
    };
  });

  // Combine To+Cc+Bcc into one comma-separated string. The webhook scans
  // it for the first kb+ address.
  const to = [msg.getTo(), msg.getCc(), msg.getBcc()].filter(Boolean).join(', ');

  const payload = {
    MessageID: msg.getId(),
    From: msg.getFrom(),
    To: to,
    Subject: msg.getSubject(),
    Attachments: attachments,
  };

  const body = JSON.stringify(payload);
  // Sign `<unix-timestamp>.<body>` so the server can reject replays older
  // than its skew window (currently ±5 minutes).
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacSha256Hex(ts + '.' + body, secret);

  const resp = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: {
      'X-Hmac-Signature': sig,
      'X-Hmac-Timestamp': String(ts),
    },
    muteHttpExceptions: true,
    followRedirects: false,
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    const snippet = (resp.getContentText() || '').substring(0, 200);
    Logger.log('webhook ' + code + ': ' + snippet);
  }
  return code;
}


function hmacSha256Hex(body, secret) {
  // computeHmacSha256Signature returns a byte array; convert to lowercase hex.
  const bytes = Utilities.computeHmacSha256Signature(body, secret);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) & 0xFF; // signed byte → unsigned
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}


/**
 * One-shot helper for testing the webhook without sending real email.
 * From the Apps Script editor: Run → testWebhook
 * Verifies HMAC + the webhook is reachable + your secret matches mira-web's.
 */
function testWebhook() {
  const secret = PropertiesService.getScriptProperties().getProperty('HMAC_SECRET');
  if (!secret) {
    Logger.log('HMAC_SECRET not set; aborting test');
    return;
  }
  const body = JSON.stringify({
    MessageID: 'apps-script-test',
    From: 'test@factorylm.com',
    To: 'kb+testtest@factorylm.com',  // unknown slug — webhook should 200 + ignore
    Subject: 'Apps Script connection test',
    Attachments: [],
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacSha256Hex(ts + '.' + body, secret);
  const resp = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: {
      'X-Hmac-Signature': sig,
      'X-Hmac-Timestamp': String(ts),
    },
    muteHttpExceptions: true,
  });
  Logger.log('Response: ' + resp.getResponseCode() + ' ' + resp.getContentText());
}
