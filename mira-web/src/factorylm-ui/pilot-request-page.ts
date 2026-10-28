/**
 * "Request a free 30-day pilot" page (#4877).
 *
 * Bounded factorylm-ui adapter — lives OUTSIDE the frozen legacy presentation
 * trees per `.claude/rules/factorylm-unified-ui-cutover.md` ("all three
 * `src/factorylm-ui/**` adapter roots" are the unguarded new-UI home).
 *
 * `renderPilotRequestPage()` is a PURE function: it takes no request-derived
 * input. utm_* and `document.referrer` are read client-side via
 * `URLSearchParams`/`document.referrer` and written into the hidden inputs'
 * `.value` through the DOM API (never `innerHTML`/server-side interpolation),
 * so there is no server-rendered reflection of attacker-controlled query
 * parameters — nothing here is a stored/reflected-XSS surface.
 *
 * Tokens: this is a plain Hono-rendered page, not a bundler-built React/Tailwind
 * surface, so per `.claude/rules/ui-style.md` rule 4's spirit it bundles a COPY
 * of the exact `--fl-*` token values from the canonical
 * `docs/design/factorylm-tokens.css` (never ad-hoc hex). Keep the copy below in
 * sync with that file — `pilot-request-page.test.ts` asserts byte-for-byte
 * parity for every token used here.
 */

const TOKENS_CSS = `:root {
  --fl-bg: #f3f4f6;
  --fl-surface: #ffffff;
  --fl-ink: #1f2937;
  --fl-muted: #6b7280;
  --fl-faint: #9ca3af;
  --fl-line: #e5e7eb;
  --fl-line-strong: #d1d5db;
  --fl-accent: #4f46e5;
  --fl-accent-hover: #4338ca;
  --fl-accent-tint: #eef2ff;
  --fl-accent-ink: #3730a3;
  --fl-fault: #dc2626;
  --fl-fault-bg: #fef2f2;
  --fl-ok: #16a34a;
  --fl-ok-bg: #f0fdf4;
  --fl-header-ink: #ffffff;
  --fl-font: "Segoe UI", system-ui, -apple-system, sans-serif;
  --fl-fs-sm: 12px;
  --fl-fs-body: 15px;
  --fl-fs-title: 17px;
  --fl-radius: 8px;
  --fl-radius-sm: 6px;
  --fl-space-1: 4px;
  --fl-space-2: 8px;
  --fl-space-3: 12px;
  --fl-space-4: 16px;
  --fl-space-6: 24px;
  --fl-space-8: 32px;
  --fl-shadow: 0 1px 2px rgba(0,0,0,.06);
}`;

const PAGE_STYLES = `
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fl-bg);
  color: var(--fl-ink);
  font-family: var(--fl-font);
  font-size: var(--fl-fs-body);
  line-height: 1.5;
}
.fl-pilot-wrap {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--fl-space-6) var(--fl-space-4) var(--fl-space-8);
}
.fl-pilot-brand {
  display: inline-block;
  margin-bottom: var(--fl-space-6);
  color: var(--fl-ink);
  font-weight: 700;
  font-size: var(--fl-fs-title);
  text-decoration: none;
}
.fl-pilot-h1 {
  font-size: 1.5rem;
  line-height: 1.25;
  margin: 0 0 var(--fl-space-2);
  color: var(--fl-ink);
}
.fl-pilot-sub {
  color: var(--fl-muted);
  margin: 0 0 var(--fl-space-6);
}
.fl-pilot-card {
  background: var(--fl-surface);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-radius);
  box-shadow: var(--fl-shadow);
  padding: var(--fl-space-4);
}
.fl-pilot-field {
  margin-bottom: var(--fl-space-4);
}
.fl-pilot-field label {
  display: block;
  font-weight: 600;
  font-size: var(--fl-fs-sm);
  color: var(--fl-ink);
  margin-bottom: var(--fl-space-1);
}
.fl-pilot-field .fl-pilot-optional {
  color: var(--fl-faint);
  font-weight: 400;
}
.fl-pilot-field input[type="text"],
.fl-pilot-field input[type="email"],
.fl-pilot-field textarea {
  width: 100%;
  padding: var(--fl-space-3);
  font-size: var(--fl-fs-body);
  font-family: var(--fl-font);
  color: var(--fl-ink);
  background: var(--fl-surface);
  border: 1px solid var(--fl-line-strong);
  border-radius: var(--fl-radius-sm);
}
.fl-pilot-field input:focus,
.fl-pilot-field textarea:focus {
  outline: 2px solid var(--fl-accent);
  outline-offset: 1px;
  border-color: var(--fl-accent);
}
.fl-pilot-field textarea {
  min-height: 88px;
  resize: vertical;
}
.fl-pilot-consent {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-space-2);
  margin-bottom: var(--fl-space-4);
}
.fl-pilot-consent input[type="checkbox"] {
  margin-top: 3px;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
}
.fl-pilot-consent label {
  font-size: var(--fl-fs-sm);
  color: var(--fl-muted);
  line-height: 1.5;
}
.fl-pilot-consent a {
  color: var(--fl-accent-ink);
}
.fl-pilot-submit {
  display: block;
  width: 100%;
  padding: var(--fl-space-3) var(--fl-space-4);
  background: var(--fl-accent);
  color: var(--fl-header-ink);
  border: none;
  border-radius: var(--fl-radius-sm);
  font-size: var(--fl-fs-body);
  font-weight: 600;
  cursor: pointer;
}
.fl-pilot-submit:hover { background: var(--fl-accent-hover); }
.fl-pilot-submit:disabled { background: var(--fl-faint); cursor: not-allowed; }
.fl-pilot-status {
  margin-top: var(--fl-space-3);
  padding: var(--fl-space-3);
  border-radius: var(--fl-radius-sm);
  font-size: var(--fl-fs-sm);
  display: none;
}
.fl-pilot-status.fl-pilot-status-ok {
  display: block;
  background: var(--fl-ok-bg);
  color: var(--fl-ok);
}
.fl-pilot-status.fl-pilot-status-error {
  display: block;
  background: var(--fl-fault-bg);
  color: var(--fl-fault);
}
.fl-pilot-foot {
  margin-top: var(--fl-space-4);
  font-size: var(--fl-fs-sm);
  color: var(--fl-faint);
  text-align: center;
}
.fl-pilot-foot a { color: var(--fl-muted); }
`;

const PAGE_SCRIPT = `
(function () {
  var form = document.getElementById('pilot-form');
  var status = document.getElementById('pilot-status');
  var submitBtn = document.getElementById('pilot-submit');
  if (!form) return;

  // Hydrate UTM + referrer via DOM API only (.value), never innerHTML — so a
  // crafted query string can never inject markup into this page.
  try {
    var params = new URLSearchParams(window.location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (key) {
      var el = document.getElementById(key);
      var val = params.get(key);
      if (el && val) el.value = val.slice(0, 200);
    });
    var refEl = document.getElementById('referrer');
    if (refEl && document.referrer) refEl.value = document.referrer.slice(0, 1000);
  } catch (e) { /* no-op — hidden fields just stay empty */ }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.className = 'fl-pilot-status';
    status.textContent = '';

    var payload = {
      name: document.getElementById('name').value,
      work_email: document.getElementById('work_email').value,
      company: document.getElementById('company').value,
      equipment: document.getElementById('equipment').value,
      consent: document.getElementById('consent').checked,
      utm_source: document.getElementById('utm_source').value || undefined,
      utm_medium: document.getElementById('utm_medium').value || undefined,
      utm_campaign: document.getElementById('utm_campaign').value || undefined,
      utm_content: document.getElementById('utm_content').value || undefined,
      utm_term: document.getElementById('utm_term').value || undefined,
      referrer: document.getElementById('referrer').value || undefined,
    };

    submitBtn.disabled = true;
    fetch('/api/pilot-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (result) {
      if (result.ok) {
        status.className = 'fl-pilot-status fl-pilot-status-ok';
        status.textContent = "Thanks — we'll reach out within one business day about your free pilot.";
        form.reset();
      } else {
        status.className = 'fl-pilot-status fl-pilot-status-error';
        var msg = (result.body && result.body.errors && result.body.errors[0]) ||
          (result.body && result.body.error) ||
          'Something went wrong. Please try again.';
        status.textContent = msg;
        submitBtn.disabled = false;
      }
    }).catch(function () {
      status.className = 'fl-pilot-status fl-pilot-status-error';
      status.textContent = 'Network error — please try again.';
      submitBtn.disabled = false;
    });
  });
})();
`;

/** Pure — no request-derived input. See module doc for the XSS rationale. */
export function renderPilotRequestPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request a free 30-day pilot — FactoryLM</title>
<meta name="description" content="The first five pilot customers get 30 days of MIRA, free. Upload your equipment manuals — CMMS connectors are optional.">
<style>${TOKENS_CSS}</style>
<style>${PAGE_STYLES}</style>
<script src="/posthog-init.js" defer></script>
</head>
<body>
<div class="fl-pilot-wrap">
  <a class="fl-pilot-brand" href="/">FactoryLM</a>
  <h1 class="fl-pilot-h1">Request a free 30-day pilot</h1>
  <p class="fl-pilot-sub">For the first five pilot customers — no cost, no card. MIRA works from the equipment manuals you upload; connecting a CMMS is optional.</p>

  <form id="pilot-form" class="fl-pilot-card" novalidate>
    <div class="fl-pilot-field">
      <label for="name">Full name</label>
      <input type="text" id="name" name="name" autocomplete="name" required maxlength="200">
    </div>
    <div class="fl-pilot-field">
      <label for="work_email">Work email</label>
      <input type="email" id="work_email" name="work_email" autocomplete="email" required maxlength="320">
    </div>
    <div class="fl-pilot-field">
      <label for="company">Company</label>
      <input type="text" id="company" name="company" autocomplete="organization" required maxlength="200">
    </div>
    <div class="fl-pilot-field">
      <label for="equipment">Equipment or manual types <span class="fl-pilot-optional">(optional)</span></label>
      <textarea id="equipment" name="equipment" maxlength="4000" placeholder="e.g. Allen-Bradley PLCs, Siemens VFDs — you can upload the actual manuals once you're in"></textarea>
    </div>

    <input type="hidden" id="utm_source" name="utm_source">
    <input type="hidden" id="utm_medium" name="utm_medium">
    <input type="hidden" id="utm_campaign" name="utm_campaign">
    <input type="hidden" id="utm_content" name="utm_content">
    <input type="hidden" id="utm_term" name="utm_term">
    <input type="hidden" id="referrer" name="referrer">

    <div class="fl-pilot-consent">
      <input type="checkbox" id="consent" name="consent" required>
      <label for="consent">I understand FactoryLM will store the information above to evaluate and follow up on this pilot request, and will use it only to contact me about the pilot. See the <a href="/privacy">privacy policy</a>.</label>
    </div>

    <button type="submit" id="pilot-submit" class="fl-pilot-submit" data-cta="pilot-request-submit">Request my free pilot spot</button>
    <div id="pilot-status" class="fl-pilot-status" role="status" aria-live="polite"></div>
  </form>

  <p class="fl-pilot-foot">No price, ever, for this pilot. Questions? <a href="mailto:mike@factorylm.com">mike@factorylm.com</a></p>
</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}
