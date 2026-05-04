const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const out = { network: [] };

  page.on('request', r => {
    const u = r.url();
    if (u.includes('stripe') || u.includes('checkout') || u.includes('signup') || u.includes('api') || u.includes('factorylm.com')) {
      out.network.push({ method: r.method(), url: u, when: 'request' });
    }
  });
  page.on('response', async r => {
    const u = r.url();
    if (u.includes('stripe') || u.includes('checkout') || u.includes('signup') || u.includes('api')) {
      out.network.push({ method: r.request().method(), url: u, status: r.status(), when: 'response' });
    }
  });
  page.on('framenavigated', f => { if (f === page.mainFrame()) out.network.push({ when: 'navigation', url: f.url() }); });

  await page.goto('https://factorylm.com/cmms', { waitUntil: 'networkidle' });

  // Check the handleSignup function in source
  out.handle_signup_source = await page.evaluate(() => {
    return typeof handleSignup === 'function' ? handleSignup.toString().slice(0, 2000) : 'NOT_DEFINED';
  });

  // Fill form and submit (test endpoints)
  await page.fill('#f-email', 'review-bot@example.com');
  await page.fill('#f-company', 'Web Review Bot Co');
  await page.fill('#f-firstname', 'AuditBot');
  await page.check('#f-terms');

  out.before_submit_url = page.url();

  // Click submit
  try {
    await Promise.race([
      page.click('#signup-btn'),
      page.waitForTimeout(500),
    ]);
    // Wait for any network or navigation
    await page.waitForTimeout(8000);
  } catch (e) {
    out.click_error = e.message;
  }

  out.after_submit_url = page.url();
  out.after_submit_title = await page.title();
  out.form_error_text = await page.evaluate(() => document.querySelector('#form-error')?.innerText?.trim());
  out.body_excerpt = await page.evaluate(() => (document.body.innerText || '').slice(0, 800));

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
