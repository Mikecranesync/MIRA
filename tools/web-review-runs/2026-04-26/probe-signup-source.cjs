// Read-only — never clicks submit. Inspects handleSignup source + scripts on /cmms.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const out = {};

  await page.goto('https://factorylm.com/cmms', { waitUntil: 'networkidle' });
  out.handle_signup_source = await page.evaluate(() => {
    return typeof handleSignup === 'function' ? handleSignup.toString() : 'NOT_DEFINED';
  });

  // Pull all inline scripts from raw HTML
  const r = await page.context().request.get('https://factorylm.com/cmms');
  const html = await r.text();
  // Find script blocks
  const scripts = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1].trim();
    if (body) scripts.push({ len: body.length, head: body.slice(0, 200), has_signup: /handleSignup|signup/i.test(body), has_stripe: /stripe/i.test(body), has_fetch: /fetch\(/.test(body) });
  }
  out.scripts_count = scripts.length;
  out.scripts = scripts;

  // Look at the actual handleSignup section
  const idx = html.indexOf('function handleSignup');
  if (idx >= 0) {
    out.handle_signup_html = html.slice(idx, idx + 2500);
  } else {
    const idx2 = html.indexOf('handleSignup');
    if (idx2 >= 0) out.handle_signup_html = html.slice(Math.max(0, idx2 - 100), idx2 + 2500);
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
