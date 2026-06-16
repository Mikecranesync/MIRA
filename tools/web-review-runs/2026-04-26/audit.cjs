// Playwright customer-journey audit for factorylm.com
// Captures console, network failures, DOM signals, mobile perturbation, focus, CTAs.
// Writes one JSON report per route + a summary.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname);
const ROUTES = [
  { name: 'landing', url: 'https://factorylm.com/' },
  { name: 'cmms', url: 'https://factorylm.com/cmms' },
  { name: 'pricing', url: 'https://factorylm.com/pricing' },
  { name: 'activated', url: 'https://factorylm.com/activated' },
];

const DOM_PAYLOAD = `
(() => {
  const r = {url: location.href};
  const imgs = [...document.querySelectorAll('img')];
  r.images_total = imgs.length;
  r.images_no_alt = imgs.filter(i => !i.hasAttribute('alt')).map(i => i.src);
  r.images_empty_alt = imgs.filter(i => i.hasAttribute('alt') && i.alt.trim() === '').length;
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  r.h1_count = headings.filter(h => h.tagName === 'H1').length;
  r.h1_text = headings.filter(h => h.tagName === 'H1').map(h => h.innerText.slice(0, 120));
  const order = headings.map(h => +h.tagName.slice(1));
  r.heading_skips = order.map((n,i) => i>0 && n-order[i-1]>1 ? \`h\${order[i-1]}->h\${n}\` : null).filter(Boolean);
  r.meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    og_title: document.querySelector('meta[property="og:title"]')?.content,
    og_image: document.querySelector('meta[property="og:image"]')?.content,
    og_url: document.querySelector('meta[property="og:url"]')?.content,
    twitter_card: document.querySelector('meta[name="twitter:card"]')?.content,
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    lang: document.documentElement.lang,
    favicon: document.querySelector('link[rel="icon"]')?.href,
    robots: document.querySelector('meta[name="robots"]')?.content,
  };
  r.deprecated_meta = ['apple-mobile-web-app-capable']
    .filter(name => document.querySelector(\`meta[name="\${name}"]\`) && !document.querySelector('meta[name="mobile-web-app-capable"]'));
  r.external_no_noopener = [...document.querySelectorAll('a[target="_blank"]')]
    .filter(a => !(a.rel||'').includes('noopener')).map(a => a.href).slice(0, 20);
  r.mixed_content = [...document.querySelectorAll('img,script,link,iframe')]
    .map(e => e.src||e.href).filter(u => u && u.startsWith('http://')).slice(0,10);
  r.tap_targets_too_small = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width>0 && b.height>0 && (b.width<44 || b.height<44); })
    .map(el => ({tag: el.tagName, text: (el.innerText||el.value||'').slice(0,60),
                 w: Math.round(el.getBoundingClientRect().width),
                 h: Math.round(el.getBoundingClientRect().height)})).slice(0,30);
  r.buttons_no_name = [...document.querySelectorAll('button')]
    .filter(b => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  r.forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action, method: f.method,
    inputs_unlabelled: [...f.querySelectorAll('input,textarea,select')].filter(i =>
      !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).length,
    input_types: [...f.querySelectorAll('input,textarea,select')].map(i => i.type || i.tagName.toLowerCase()),
  }));
  r.jsonld_types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
    try { const o = JSON.parse(s.textContent); return o['@type'] || (o['@graph']||[]).map(x=>x['@type']) || 'unknown'; }
    catch { return 'INVALID_JSON'; }
  });
  // CTAs by visible text
  const ctaWords = /^(sign up|sign in|signup|signin|log in|login|get started|start free|try|try free|try mira|book demo|book a demo|request demo|subscribe|buy|checkout|activate|connect|continue|create account|join|get|see pricing|view pricing)$/i;
  r.ctas = [...document.querySelectorAll('a,button')].filter(el => {
    const t = (el.innerText||el.value||'').trim();
    return t && ctaWords.test(t);
  }).map(el => ({tag: el.tagName, text: el.innerText.trim().slice(0,80), href: el.href || null, disabled: el.disabled || false}));
  // Links
  r.links_total = document.querySelectorAll('a[href]').length;
  r.links_internal = [...document.querySelectorAll('a[href]')].filter(a => {
    try { return new URL(a.href, location.href).hostname === location.hostname; } catch { return false; }
  }).map(a => a.getAttribute('href')).slice(0, 200);
  r.links_external = [...new Set([...document.querySelectorAll('a[href]')].filter(a => {
    try { return new URL(a.href, location.href).hostname !== location.hostname; } catch { return false; }
  }).map(a => a.href))].slice(0, 60);
  // Body length sanity
  r.body_text_len = (document.body.innerText || '').length;
  r.has_main_landmark = !!document.querySelector('main, [role="main"]');
  r.has_nav_landmark = !!document.querySelector('nav, [role="navigation"]');
  r.has_footer_landmark = !!document.querySelector('footer, [role="contentinfo"]');
  // Color contrast we skip (need a11y engine); just count text nodes for sanity
  return r;
})()
`;

async function auditRoute(browser, route) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 web-review-bot',
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  const failedRequests = [];

  page.on('console', m => {
    const o = { type: m.type(), text: m.text(), location: m.location() };
    consoleMsgs.push(o);
    if (m.type() === 'error') consoleErrors.push(o);
  });
  page.on('pageerror', e => pageErrors.push({ message: e.message, stack: (e.stack||'').slice(0, 800) }));
  page.on('requestfailed', r => failedRequests.push({ url: r.url(), method: r.method(), failure: r.failure()?.errorText }));
  page.on('response', async r => {
    const status = r.status();
    const u = r.url();
    if (status >= 400) {
      requests.push({ url: u, status, method: r.request().method() });
    }
  });

  const result = { route: route.name, url: route.url, started_at: new Date().toISOString() };

  try {
    const resp = await page.goto(route.url, { waitUntil: 'networkidle', timeout: 30000 });
    result.status = resp ? resp.status() : null;
    result.final_url = page.url();
    // wait a beat for hydration
    await page.waitForTimeout(1500);
    result.dom_desktop = await page.evaluate(DOM_PAYLOAD);

    // mobile perturbation
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800);
    result.dom_mobile = await page.evaluate(DOM_PAYLOAD);

    // tab focus check
    const focusBefore = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    result.focus_after_3tab = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY', text: '', visible: false };
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0,60),
        in_viewport: r.top >= 0 && r.bottom <= window.innerHeight,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
    result.focus_before = focusBefore;

    // scroll bottom + check new errors
    const errsBefore = consoleErrors.length;
    const pageErrsBefore = pageErrors.length;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    result.scroll_introduced_errors = (consoleErrors.length - errsBefore) + (pageErrors.length - pageErrsBefore);

  } catch (e) {
    result.fatal = e.message;
  }

  result.console_errors = consoleErrors;
  result.console_warnings = consoleMsgs.filter(m => m.type === 'warning');
  result.page_errors = pageErrors;
  result.failed_responses = requests;
  result.failed_requests = failedRequests;
  result.finished_at = new Date().toISOString();

  await ctx.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [];
  for (const route of ROUTES) {
    process.stderr.write(`\n--- auditing ${route.url}\n`);
    try {
      const r = await auditRoute(browser, route);
      all.push(r);
      const file = path.join(OUT_DIR, `route-${route.name}.json`);
      fs.writeFileSync(file, JSON.stringify(r, null, 2));
    } catch (e) {
      process.stderr.write(`FATAL on ${route.url}: ${e.message}\n`);
      all.push({ route: route.name, url: route.url, fatal: e.message });
    }
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'audit-summary.json'), JSON.stringify(all, null, 2));
  process.stderr.write(`\nWrote ${all.length} route reports to ${OUT_DIR}\n`);
})();
