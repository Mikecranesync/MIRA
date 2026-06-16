# FactoryLM PLG Funnel — Claude Code PRD
## Product Requirements Document · `/cmms` Acquisition & Onboarding Flow
**Version:** 1.0 · **Date:** April 2026 · **Executor:** Claude Code CLI

---

## Purpose

Implement a complete Product-Led Growth (PLG) acquisition funnel for FactoryLM starting at `factorylm.com/cmms`. A visitor enters their email, lands immediately inside a working CMMS, receives 5 free Mira AI fault queries, and is guided to install the mobile app. Every step is fully automated — no sales call, no manual provisioning.

**Success criterion:** A visitor who clicks any CTA button on the page becomes a CMMS user with the app installed and at least one Mira query fired, in under 3 minutes.

---

## Scope

Files touched in this PRD:

```
mira-web/
├── server.js                        ← add 6 new routes
├── public/
│   ├── cmms.html                    ← replace existing with gated version
│   ├── cmms.css                     ← replace existing
│   ├── manifest.json                ← new (PWA)
│   ├── sw.js                        ← new (service worker)
│   └── icons/
│       ├── icon-192.png             ← new (generate from logo)
│       └── icon-512.png             ← new
├── lib/
│   ├── mailer.js                    ← new (Resend email sender)
│   ├── sms.js                       ← new (Twilio SMS sender)
│   └── auth.js                      ← new (JWT helpers)
├── emails/
│   ├── welcome.html                 ← new (Day 0)
│   ├── activation.html              ← new (Day 1)
│   ├── feature.html                 ← new (Day 3)
│   ├── social-proof.html            ← new (Day 7)
│   ├── nudge.html                   ← new (Day 10)
│   └── conversion.html              ← new (Day 14)
└── .env                             ← add 8 new env vars
```

External services provisioned in this PRD:
- **Resend** — transactional email
- **Twilio** — SMS app-install link
- **Atlas CMMS** (existing, via `mira-mcp`) — tenant + WO creation

---

## Architecture

```
Visitor → CTA click → email field → POST /api/register
                                          ↓
                               Create Atlas tenant (mira-mcp)
                               Seed demo WOs for tenant
                               Issue JWT (30d)
                               Send welcome email (Resend)
                               Send SMS install link (Twilio) ← if phone provided later
                                          ↓
                               Redirect → /cmms?token=<jwt>
                                          ↓
                               CMMS unlocked in browser
                               5 Mira queries available
                               Onboarding checklist visible
                                          ↓
                               User fires first Mira query
                               → /api/mira/chat (existing SSE)
                               → WO auto-created if "WO RECOMMENDED:"
                               → query_count decremented in Atlas tenant
                                          ↓
                               User creates first real WO
                               → App install banner shown
                               → "Send link to my phone" → POST /api/send-app-link
                                          ↓
                               Email drip starts (Loops.so or n8n)
                               → Day 0, 1, 3, 7, 10, 14
```

---

## Phase 1 — Environment & Dependencies

### 1.1 Install npm packages

```bash
cd mira-web
npm install resend twilio jsonwebtoken dotenv
```

### 1.2 Add to .env

```bash
# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=mira@factorylm.com
EMAIL_FROM_NAME=Mira at FactoryLM

# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
TWILIO_FROM=+18635550100

# Auth
JWT_SECRET=<generate with: openssl rand -hex 32>
JWT_EXPIRY=30d

# App store links (update when apps are published)
APP_STORE_URL=https://apps.apple.com/app/factorylm/id000000000
PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.factorylm
PWA_URL=https://factorylm.com/cmms?pwa=1

# Mira limits (free tier)
FREE_DAILY_QUERIES=5
```

---

## Phase 2 — Library Modules

### 2.1 `mira-web/lib/auth.js`

```javascript
const jwt = require('jsonwebtoken');

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '30d'
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware — reads Bearer header or ?token= query param
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const query  = req.query.token;
  const raw    = header ? header.replace('Bearer ', '') : query;
  if (!raw) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(raw);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  next();
}

module.exports = { signToken, verifyToken, requireAuth };
```

### 2.2 `mira-web/lib/mailer.js`

```javascript
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, templateName, vars }) {
  const templatePath = path.join(__dirname, '..', 'emails', `${templateName}.html`);
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Simple variable substitution — {{VAR_NAME}}
  for (const [key, val] of Object.entries(vars || {})) {
    html = html.replaceAll(`{{${key}}}`, val);
  }

  return resend.emails.send({
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html
  });
}

module.exports = { sendEmail };
```

### 2.3 `mira-web/lib/sms.js`

```javascript
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendAppInstallLink(phone, firstName) {
  const body = [
    `Hi ${firstName}! Your FactoryLM CMMS is live.`,
    `iOS: ${process.env.APP_STORE_URL}`,
    `Android: ${process.env.PLAY_STORE_URL}`,
    `Web: ${process.env.PWA_URL}`,
    `Reply STOP to opt out.`
  ].join(' ');

  return client.messages.create({
    body,
    from: process.env.TWILIO_FROM,
    to:   phone
  });
}

module.exports = { sendAppInstallLink };
```

---

## Phase 3 — Server Routes

Add all six routes to `mira-web/server.js`. Place them **before** the `express.static` middleware block. Import libs at the top of the file.

### 3.0 Imports to add at top of server.js

```javascript
const jwt       = require('jsonwebtoken');
const { signToken, verifyToken, requireAuth } = require('./lib/auth');
const { sendEmail }          = require('./lib/mailer');
const { sendAppInstallLink } = require('./lib/sms');
```

---

### Route A: `POST /api/register`

Creates Atlas tenant, seeds demo data, issues JWT, sends welcome email.

```javascript
app.post('/api/register', express.json(), async (req, res) => {
  const { email, firstName, lastName, company, role, phone } = req.body;

  // Validation
  if (!email || !company) {
    return res.status(400).json({ error: 'email and company are required' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // 1. Create Atlas tenant via mira-mcp
    const tenantRes = await fetch(`${process.env.MCP_BASE}/api/cmms/tenants`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${process.env.MCP_REST_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, company, plan: 'free', dailyQueryLimit: parseInt(process.env.FREE_DAILY_QUERIES) || 5 })
    });
    const tenant = await tenantRes.json();
    if (!tenantRes.ok) throw new Error(tenant.error || 'Tenant creation failed');

    // 2. Seed 3 demo WOs for this tenant (async, don't block response)
    seedDemoWorkOrders(tenant.id).catch(console.error);

    // 3. Issue JWT
    const token = signToken({ tenantId: tenant.id, email, company, role: role || 'unknown' });

    // 4. Send welcome email (async)
    sendEmail({
      to:           email,
      subject:      'Your FactoryLM CMMS is live — start here',
      templateName: 'welcome',
      vars:         { FIRST_NAME: firstName || email.split('@')[0], COMPANY: company, TOKEN: token }
    }).catch(console.error);

    // 5. SMS if phone provided
    if (phone) {
      sendAppInstallLink(phone, firstName || 'there').catch(console.error);
    }

    res.json({ success: true, token, tenantId: tenant.id });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});
```

---

### Route B: `POST /api/send-app-link`

Called when user clicks "Send app link to my phone" inside the CMMS.

```javascript
app.post('/api/send-app-link', requireAuth, express.json(), async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  try {
    await sendAppInstallLink(phone, req.user.email.split('@')[0]);
    res.json({ success: true });
  } catch (err) {
    console.error('SMS error:', err);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});
```

---

### Route C: `GET /demo/work-orders`

Public read-only proxy — returns demo WOs for the scrolling ticker on the unauthenticated hero. No auth required. Returns a static curated list so the ticker always looks good.

```javascript
app.get('/demo/work-orders', (req, res) => {
  // Static ticker data — always looks alive, no Atlas dependency on the public page
  res.json([
    { id: 'WO000341', title: 'VFD overcurrent fault E05 — Pump Station 2',     priority: 'HIGH',   status: 'OPEN',        ai: true,  assetName: 'GS10 VFD',           minutesAgo: 4  },
    { id: 'WO000342', title: 'Conveyor belt tension adjustment — Line 3',       priority: 'MEDIUM', status: 'IN_PROGRESS', ai: false, assetName: 'Conveyor Belt',      minutesAgo: 22 },
    { id: 'WO000343', title: 'Air compressor won\'t build pressure — Shop Floor', priority: 'HIGH', status: 'OPEN',        ai: true,  assetName: 'Air Compressor',     minutesAgo: 37 },
    { id: 'WO000344', title: 'Robot joint 3 grease interval overdue — Cell 4',  priority: 'MEDIUM', status: 'OPEN',        ai: false, assetName: 'FANUC R-30iB',       minutesAgo: 61 },
    { id: 'WO000345', title: 'Encoder cable replacement — Cell 4',              priority: 'HIGH',   status: 'COMPLETE',    ai: true,  assetName: 'FANUC R-30iB',       minutesAgo: 180 },
    { id: 'WO000346', title: 'Bearing temp high on drive motor — Line 3',       priority: 'HIGH',   status: 'OPEN',        ai: true,  assetName: 'Drive Motor',        minutesAgo: 8  },
    { id: 'WO000347', title: 'Hydraulic pressure drop — Press Station 1',       priority: 'MEDIUM', status: 'IN_PROGRESS', ai: false, assetName: 'Hydraulic Press',    minutesAgo: 95 },
    { id: 'WO000348', title: 'PLC comms loss — Packaging Line 2',               priority: 'HIGH',   status: 'OPEN',        ai: true,  assetName: 'Allen-Bradley PLC',  minutesAgo: 12 },
  ]);
});
```

---

### Route D: `GET /demo/tenant-work-orders`

Authenticated. Returns real WOs for THIS user's Atlas tenant after they register.

```javascript
app.get('/demo/tenant-work-orders', requireAuth, async (req, res) => {
  try {
    const r = await fetch(
      `${process.env.MCP_BASE}/api/cmms/work-orders?tenantId=${req.user.tenantId}&limit=50`,
      { headers: { Authorization: `Bearer ${process.env.MCP_REST_API_KEY}` } }
    );
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch work orders' });
  }
});
```

---

### Route E: `GET /demo/query-quota`

Returns how many Mira queries the user has left today.

```javascript
app.get('/demo/query-quota', requireAuth, async (req, res) => {
  try {
    const r = await fetch(
      `${process.env.MCP_BASE}/api/cmms/tenants/${req.user.tenantId}/quota`,
      { headers: { Authorization: `Bearer ${process.env.MCP_REST_API_KEY}` } }
    );
    res.json(await r.json());
  } catch {
    // Graceful fallback
    res.json({ queriesUsedToday: 0, dailyLimit: parseInt(process.env.FREE_DAILY_QUERIES) || 5 });
  }
});
```

---

### Route F: `GET /cmms` (page route)

```javascript
// Must be placed BEFORE express.static middleware
app.get('/cmms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cmms.html'));
});
```

---

### Helper: `seedDemoWorkOrders(tenantId)`

Add this function in server.js (not a route):

```javascript
async function seedDemoWorkOrders(tenantId) {
  const base = `${process.env.MCP_BASE}/api/cmms/work-orders`;
  const headers = {
    Authorization:  `Bearer ${process.env.MCP_REST_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const demos = [
    { title: 'VFD overcurrent fault E05 — Pump Station 2', status: 'OPEN',        priority: 'HIGH',   description: 'F05 fault code on GS10 VFD. DC bus voltage 8% below nominal. Capacitor check recommended.' },
    { title: 'Conveyor belt tension adjustment — Line 3',  status: 'IN_PROGRESS', priority: 'MEDIUM', description: 'Belt tracking off by ~3mm at tail pulley. Adjust take-up assembly.' },
    { title: 'Robot joint 3 lubrication — quarterly PM',  status: 'OPEN',        priority: 'MEDIUM', description: 'Scheduled quarterly PM. 80cc grease via Zerk fitting at J3 axis.' },
  ];
  for (const wo of demos) {
    await fetch(base, {
      method:  'POST',
      headers,
      body: JSON.stringify({ ...wo, tenantId, createdBy: 'demo-seed' })
    });
  }
}
```

---

## Phase 4 — PWA Files

### 4.1 `mira-web/public/manifest.json`

```json
{
  "name": "FactoryLM CMMS",
  "short_name": "FactoryLM",
  "description": "AI-powered work order management for industrial maintenance",
  "start_url": "/cmms",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0d0d0b",
  "theme_color": "#f5a623",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ]
}
```

### 4.2 `mira-web/public/sw.js`

```javascript
const CACHE_NAME = 'factorylm-v1';
const PRECACHE_URLS = ['/cmms', '/manifest.json'];
const API_PREFIXES  = ['/api/', '/demo/'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Never intercept API calls — always fresh
  if (API_PREFIXES.some(p => event.request.url.includes(p))) return;

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        // Cache successful GET responses for the app shell
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
    )
  );
});
```

### 4.3 Add to `cmms.html` `<head>`

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#f5a623">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="FactoryLM CMMS">
<link rel="apple-touch-icon" href="/icons/icon-192.png">

<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js');
    });
  }

  // Capture beforeinstallprompt so we can show a branded install button
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'inline-flex';
  });
  window.installPWA = async function() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('pwa-install-btn').style.display = 'none';
    }
    deferredInstallPrompt = null;
  };
</script>
```

### 4.4 Generate app icons

```bash
# Run once — requires ImageMagick (apt install imagemagick)
cd mira-web/public
mkdir -p icons

# Create a simple amber-on-dark icon from the SVG logo
# Replace with your actual brand logo generation
convert -size 512x512 xc:"#0d0d0b" \
  -fill "#f5a623" -draw "polygon 256,60 56,160 256,260 456,160" \
  -draw "polyline 56,260 256,360 456,260" \
  -draw "polyline 56,360 256,460 456,360" \
  icons/icon-512.png

convert icons/icon-512.png -resize 192x192 icons/icon-192.png
echo "Icons generated"
```

---

## Phase 5 — `cmms.html` Frontend Flow

The full `cmms.html` implements these JS behaviors. Each section is a distinct JS module.

### 5.1 Auth State Machine

```javascript
// State
let AUTH = { token: null, user: null, queriesLeft: 5, queriesLimit: 5 };

// On page load: check for ?token= in URL (post-registration redirect)
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    AUTH.token = urlToken;
    // Clean URL without reloading
    history.replaceState(null, '', '/cmms');
    await activateAuthenticatedState();
  }
  // Also check sessionStorage for returning visitors in same session
  const stored = sessionStorage.getItem('flm_token');
  if (stored && !AUTH.token) {
    AUTH.token = stored;
    await activateAuthenticatedState();
  }

  initTicker();
  lucide.createIcons();
});

async function activateAuthenticatedState() {
  sessionStorage.setItem('flm_token', AUTH.token);

  // Unlock UI
  document.getElementById('kanban-wrap').classList.add('unlocked');
  document.getElementById('board-lock-overlay').classList.add('hidden');
  document.getElementById('try-locked').style.display = 'none';
  document.getElementById('try-input-wrap').classList.add('show');
  document.getElementById('checklist-panel').style.display = 'flex';
  document.getElementById('query-quota-bar').style.display = 'flex';

  // Fetch real data
  await Promise.all([fetchTenantWorkOrders(), fetchQueryQuota()]);
  startBoardRefresh();
  lucide.createIcons();
}
```

### 5.2 Signup Form Handler

```javascript
async function handleSignup() {
  const email   = document.getElementById('f-email').value.trim();
  const company = document.getElementById('f-company').value.trim();
  // Optional enrichment fields — collected but not required
  const firstName = document.getElementById('f-firstname')?.value.trim() || '';
  const role      = document.getElementById('f-role')?.value || '';

  const errEl = document.getElementById('form-error');
  if (!email || !company) {
    errEl.textContent = 'Email and company name are required.';
    errEl.classList.add('show');
    return;
  }

  const btn = document.getElementById('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 1s linear infinite"></i> Creating your account…';
  lucide.createIcons();

  try {
    const res = await fetch('/api/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, company, firstName, role })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Registration failed');

    AUTH.token = data.token;
    sessionStorage.setItem('flm_token', data.token);

    // Transition: hide form, show success + download prompt
    document.getElementById('signup-form-wrap').style.display = 'none';
    document.getElementById('download-step').classList.add('show');

    const name = firstName || email.split('@')[0];
    document.getElementById('download-greeting').textContent =
      `Welcome, ${name}. Your CMMS is live with ${AUTH.queriesLimit} free Mira queries. Install the app to take it to the floor.`;

    await activateAuthenticatedState();

  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="zap" style="width:16px;height:16px"></i> Create Account & Get App';
    lucide.createIcons();
  }
}
```

### 5.3 Live Ticker (unauthenticated hero — fake data, always beautiful)

```javascript
async function initTicker() {
  const res = await fetch('/demo/work-orders');
  const wos = await res.json();
  const list = document.getElementById('hero-wo-list');
  let idx = 0;

  // Initial render — 3 cards
  list.innerHTML = '';
  for (let i = 0; i < Math.min(3, wos.length); i++) renderTickerCard(wos[i], list);
  lucide.createIcons();

  // Slide a new card in every 6 seconds
  setInterval(() => {
    idx = (idx + 1) % wos.length;
    const wo = wos[idx];
    const card = document.createElement('div');
    card.style.cssText = 'opacity:0;transform:translateY(-8px);transition:all 0.4s cubic-bezier(0.16,1,0.3,1)';
    card.innerHTML = tickerCardHTML(wo);
    list.insertBefore(card, list.firstChild);
    // Remove last card if > 3
    if (list.children.length > 3) {
      const last = list.lastChild;
      last.style.cssText += 'opacity:0;transform:translateY(8px)';
      setTimeout(() => last.remove(), 400);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });
    });
    lucide.createIcons();
  }, 6000);
}

function tickerCardHTML(wo) {
  const minsAgo = wo.minutesAgo;
  const time = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo/60)}h ago`;
  const priorityBadge = { HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' }[wo.priority];
  const aiBadge = wo.ai ? '<span class="badge badge-ai">AI</span>' : '';
  return `
    <div class="mini-wo">
      <span class="mini-wo-id">${wo.id}</span>
      <div class="mini-wo-content">
        <div class="mini-wo-title">${wo.title}</div>
        <div class="mini-wo-asset">${wo.assetName} · ${time}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <span class="badge ${priorityBadge}">${wo.priority}</span>
        ${aiBadge}
      </div>
    </div>`;
}
```

### 5.4 Query Quota Bar

Shown above the Try It input once authenticated.

```javascript
async function fetchQueryQuota() {
  try {
    const res = await fetch('/demo/query-quota', {
      headers: { Authorization: `Bearer ${AUTH.token}` }
    });
    const data = await res.json();
    AUTH.queriesLeft  = data.dailyLimit - data.queriesUsedToday;
    AUTH.queriesLimit = data.dailyLimit;
    updateQuotaBar();
  } catch {
    // Fallback
    AUTH.queriesLeft = process.env.FREE_DAILY_QUERIES || 5;
    updateQuotaBar();
  }
}

function updateQuotaBar() {
  const bar = document.getElementById('query-quota-bar');
  if (!bar) return;
  const pct = (AUTH.queriesLeft / AUTH.queriesLimit) * 100;
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;font-size:var(--text-xs)">
      <span style="color:var(--text-muted)">Mira queries today:</span>
      <div style="flex:1;height:4px;background:var(--surface-3);border-radius:99px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:var(--amber);transition:width 0.6s ease;border-radius:99px"></div>
      </div>
      <span style="color:var(--amber);font-weight:700;font-variant-numeric:tabular-nums">
        ${AUTH.queriesLeft} / ${AUTH.queriesLimit}
      </span>
      ${AUTH.queriesLeft <= 1 ? '<a href="/pricing" style="color:var(--amber);text-decoration:underline;font-weight:600">Upgrade →</a>' : ''}
    </div>`;
}
```

### 5.5 Mira Query → Auto WO Creation

```javascript
async function submitFaultQuery() {
  if (AUTH.queriesLeft <= 0) {
    showQuotaExhaustedModal();
    return;
  }

  const input = document.getElementById('try-input');
  const query = input.value.trim();
  if (!query) return;

  const respEl   = document.getElementById('try-response');
  const respText = document.getElementById('try-response-text');
  const toast    = document.getElementById('wo-toast');
  toast.classList.remove('show');
  respEl.classList.add('show', 'typing');
  respText.textContent = '';
  input.value = '';
  input.disabled = true;

  // SSE to existing /api/mira/chat endpoint
  const evtSource = new EventSource(
    `/api/mira/chat?q=${encodeURIComponent(query)}&token=${AUTH.token}`
  );
  let fullText = '';
  let woCreated = false;

  evtSource.onmessage = async e => {
    const chunk = e.data;
    if (chunk === '[DONE]') {
      evtSource.close();
      respEl.classList.remove('typing');
      input.disabled = false;
      AUTH.queriesLeft = Math.max(0, AUTH.queriesLeft - 1);
      updateQuotaBar();

      // Trigger WO creation if Mira recommended one
      if (fullText.includes('WO RECOMMENDED:') && !woCreated) {
        woCreated = true;
        const titleMatch = fullText.match(/WO RECOMMENDED:\s*(.+)/);
        const title = titleMatch ? titleMatch[1].trim() : `Fault diagnosis — ${query.substring(0, 60)}`;
        await autoCreateWorkOrder(title);
      }
      // Show app install prompt after first successful query
      checkAndShowAppInstallBanner();
      return;
    }
    fullText += chunk;
    respText.textContent = fullText;
  };

  evtSource.onerror = () => {
    evtSource.close();
    respEl.classList.remove('typing');
    input.disabled = false;
    respText.textContent += '\n\n[Connection error — please try again]';
  };
}

async function autoCreateWorkOrder(title) {
  try {
    const res = await fetch('/api/mira/work-order', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${AUTH.token}`
      },
      body: JSON.stringify({ title, priority: 'HIGH', createdBy: 'Mira AI', aiGenerated: true })
    });
    const wo = await res.json();
    const toast    = document.getElementById('wo-toast');
    const toastMsg = document.getElementById('wo-toast-msg');
    toastMsg.textContent = `Work order ${wo.customId || wo.id} created and added to the board.`;
    toast.classList.add('show');
    await fetchTenantWorkOrders(); // Refresh board
    markChecklistStep('step-create-wo');
  } catch (err) {
    console.error('WO creation failed:', err);
  }
}
```

### 5.6 Onboarding Checklist

3-step panel shown only to authenticated users, left sidebar or bottom panel.

```javascript
const CHECKLIST_STEPS = {
  'step-account':   { label: 'Create your account',            done: true  },
  'step-ask-mira':  { label: 'Ask Mira your first fault',       done: false },
  'step-create-wo': { label: 'Create your first work order',    done: false },
};

function renderChecklist() {
  const container = document.getElementById('checklist-steps');
  if (!container) return;
  container.innerHTML = Object.entries(CHECKLIST_STEPS).map(([id, step]) => `
    <div class="checklist-step ${step.done ? 'done' : ''}" id="${id}">
      <div class="checklist-icon">
        ${step.done
          ? '<i data-lucide="check-circle-2" style="color:var(--green)"></i>'
          : '<i data-lucide="circle" style="color:var(--text-faint)"></i>'}
      </div>
      <span>${step.label}</span>
    </div>
  `).join('');
  lucide.createIcons();
}

function markChecklistStep(stepId) {
  if (CHECKLIST_STEPS[stepId]) {
    CHECKLIST_STEPS[stepId].done = true;
    renderChecklist();
  }
  // Mark ask-mira on first query
  if (stepId === 'step-create-wo') markChecklistStep('step-ask-mira');
}
```

### 5.7 App Install Banner (triggered after first real WO)

```javascript
function checkAndShowAppInstallBanner() {
  const banner = document.getElementById('app-install-banner');
  if (!banner || banner.dataset.shown) return;
  banner.dataset.shown = '1';
  banner.style.display = 'flex';
  banner.style.animation = 'slideIn 0.4s cubic-bezier(0.16,1,0.3,1)';
}

async function sendPhoneLink() {
  const phone = document.getElementById('phone-input').value.trim();
  if (!phone) return;
  const btn = document.getElementById('send-link-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await fetch('/api/send-app-link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH.token}` },
      body:    JSON.stringify({ phone })
    });
    btn.textContent = '✓ Sent!';
    setTimeout(() => document.getElementById('app-install-banner').style.display = 'none', 2000);
  } catch {
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}
```

### 5.8 Quota Exhausted Modal

```javascript
function showQuotaExhaustedModal() {
  const modal = document.getElementById('quota-modal');
  if (modal) { modal.style.display = 'flex'; lucide.createIcons(); }
}
// In HTML: a modal with "Resets tomorrow" message + "Upgrade to Pro → unlimited" CTA linking to /pricing
```

---

## Phase 6 — Email Templates

All templates live in `mira-web/emails/`. Use `{{VAR_NAME}}` placeholders replaced by `mailer.js`.

### Template variables available in all emails

| Variable | Value |
|---|---|
| `{{FIRST_NAME}}` | User's first name (or email prefix) |
| `{{COMPANY}}` | Company name from signup |
| `{{TOKEN}}` | JWT (for magic-link CTAs direct into CMMS) |
| `{{CMMS_URL}}` | `https://factorylm.com/cmms?token={{TOKEN}}` |
| `{{QUERIES_LEFT}}` | Today's remaining Mira queries |
| `{{UPGRADE_URL}}` | `https://factorylm.com/pricing` |

### Email 1: `welcome.html` — sent immediately on registration

```
Subject: Your FactoryLM CMMS is live — start here
From:    Mira at FactoryLM

Hey {{FIRST_NAME}},

Your CMMS is live. 3 demo work orders are already in your board.

You also have {{QUERIES_LEFT}} free Mira AI queries — use them on real faults.

[Open my CMMS →]  (magic link, no password needed)

Here's what to do in the next 5 minutes:
1. Ask Mira a fault you've seen before. Watch the diagnosis.
2. If she recommends a WO, one gets created automatically.
3. Install the app on your phone so you have it on the floor.

— Mira
```

### Email 2: `activation.html` — Day 1, only if no Mira query fired

```
Subject: 30 seconds to try the AI that writes your work orders
From:    Mira at FactoryLM

Hi {{FIRST_NAME}},

You signed up yesterday but haven't asked Mira a fault yet.

Try this: type any fault code you've seen this week.
She'll give you a full diagnosis tree — and if it warrants a WO,
she'll create it automatically.

[Ask Mira your first fault →]

```

### Email 3: `feature.html` — Day 3

```
Subject: How to turn a fault code into a closed WO automatically
```

### Email 4: `social-proof.html` — Day 7

```
Subject: "Cut repeat failures 40%" — how one tech used FactoryLM
```

### Email 5: `nudge.html` — Day 10, only if < 3 queries used

```
Subject: You have {{QUERIES_LEFT}} Mira queries left today
```

### Email 6: `conversion.html` — Day 14

```
Subject: Your free queries reset daily — unlimited is $49/mo
```

**Trigger these via n8n** (already in your stack): create a workflow that fires on `user.registered` event with a `Wait` node for each delay. The `/api/register` route should POST a webhook to n8n after tenant creation.

```javascript
// Add to /api/register after tenant is created:
fetch(process.env.N8N_WEBHOOK_REGISTER, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, firstName, company, tenantId: tenant.id, role })
}).catch(console.error);
```

---

## Phase 7 — Atlas CMMS API Changes (mira-mcp)

The following endpoints must exist in `mira-mcp` for the server routes above to work. Verify or create them.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/cmms/tenants` | Create tenant. Body: `{ email, company, plan, dailyQueryLimit }`. Returns `{ id, ... }` |
| `GET`  | `/api/cmms/work-orders?tenantId=&limit=` | Tenant-scoped WO list |
| `POST` | `/api/cmms/work-orders` | Create WO. Body: `{ title, status, priority, tenantId, description, createdBy }` |
| `GET`  | `/api/cmms/tenants/:id/quota` | Returns `{ queriesUsedToday, dailyLimit }` |
| `POST` | `/api/cmms/tenants/:id/increment-query` | Called by `/api/mira/chat` when query fires. Increments daily count. |

---

## Phase 8 — nginx Config Update

```nginx
# /etc/nginx/sites-available/factorylm.com
# Add these location blocks (before the catch-all)

location /cmms {
    proxy_pass http://mira-web:3200;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location /api/ {
    proxy_pass http://mira-web:3200;
    proxy_set_header Host $host;
    # SSE support for /api/mira/chat
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}

location /demo/ {
    proxy_pass http://mira-web:3200;
    proxy_set_header Host $host;
}

location /sw.js {
    proxy_pass http://mira-web:3200;
    add_header Cache-Control "no-cache";
}

location /manifest.json {
    proxy_pass http://mira-web:3200;
    add_header Cache-Control "public, max-age=86400";
}
```

---

## Verification Checklist

Run these in order after deployment. Every item must pass before launch.

```bash
# Phase 1: Routes exist
curl -sf https://factorylm.com/cmms | grep -q "FactoryLM" && echo "PASS: /cmms page"
curl -sf https://factorylm.com/demo/work-orders | python3 -m json.tool | grep -q "WO0" && echo "PASS: /demo/work-orders"
curl -sf https://factorylm.com/manifest.json | python3 -m json.tool | grep -q "FactoryLM CMMS" && echo "PASS: manifest.json"

# Phase 2: Registration flow
TOKEN=$(curl -sf -X POST https://factorylm.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@yourplant.com","company":"Test Plant","firstName":"Tech"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token: $TOKEN"

# Phase 3: Authenticated WO fetch
curl -sf https://factorylm.com/demo/tenant-work-orders \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Phase 4: Query quota
curl -sf https://factorylm.com/demo/query-quota \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Phase 5: SMS test (replace with real number)
curl -sf -X POST https://factorylm.com/api/send-app-link \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"phone":"+18635550100"}'

# Phase 6: Welcome email check
# → Check inbox for test@yourplant.com

# Phase 7: PWA install
# → Open https://factorylm.com/cmms on mobile Chrome
# → Verify "Add to Home Screen" prompt appears
# → Verify amber icon on home screen after install

# Phase 8: End-to-end
# → Go to https://factorylm.com/cmms
# → Enter email + company → click Create Account
# → Confirm redirect into CMMS (no reload)
# → Confirm demo WOs on board
# → Confirm 5/5 query bar visible
# → Type "air compressor won't build pressure" → Ask Mira
# → Confirm typewriter response
# → Confirm WO auto-created
# → Confirm WO count increments in hero stats
# → Confirm app install banner appears
# → Confirm checklist step 2 + 3 marked complete
```

---

## Out of Scope (Next Phase)

- Native iOS / Android app (React Native) — PWA covers this at launch
- Email sequence automation in Loops.so — n8n handles Day 0/1/3 for now
- Role-based onboarding branching (tech vs manager)
- Upgrade / billing flow (Stripe) — referenced in `FactoryLM_V2_FastAPI_Spec.md`
- Password reset / magic link auth (current flow is token-in-URL; fine for demo phase)
