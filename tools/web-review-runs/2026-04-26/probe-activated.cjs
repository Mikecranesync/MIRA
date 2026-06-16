const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const out = { navigations: [] };

  page.on('framenavigated', f => {
    if (f === page.mainFrame()) out.navigations.push({ url: f.url(), at: Date.now() });
  });

  // Bare /activated — what does it look like before JS may redirect
  await page.goto('https://factorylm.com/activated', { waitUntil: 'domcontentloaded' });
  out.dom_loaded_url = page.url();
  out.dom_loaded_title = await page.title();
  await page.waitForTimeout(3000);
  out.after_3s_url = page.url();
  out.after_3s_title = await page.title();
  out.after_3s_h1 = await page.evaluate(() => document.querySelector('h1')?.innerText?.trim());

  // Try with a session_id query param like Stripe would send
  out.with_stripe_session = await (async () => {
    const p2 = await ctx.newPage();
    const navs = [];
    p2.on('framenavigated', f => { if (f === p2.mainFrame()) navs.push(f.url()); });
    await p2.goto('https://factorylm.com/activated?session_id=cs_test_a1B2c3D4e5F6', { waitUntil: 'domcontentloaded' });
    const t1 = await p2.title();
    await p2.waitForTimeout(3000);
    const result = {
      navs,
      final_url: p2.url(),
      title_before_wait: t1,
      title_after_wait: await p2.title(),
      h1: await p2.evaluate(() => document.querySelector('h1')?.innerText?.trim()),
      body_excerpt: await p2.evaluate(() => (document.body.innerText || '').slice(0, 1200)),
    };
    await p2.close();
    return result;
  })();

  // Get the raw HTML so we can find the redirect
  const resp = await page.context().request.get('https://factorylm.com/activated');
  const html = await resp.text();
  out.raw_html_len = html.length;
  // Look for redirect patterns
  const patterns = [
    /location\.replace/g, /location\.href\s*=/g, /window\.location/g,
    /<meta[^>]*http-equiv[^>]*refresh/i,
    /history\.replaceState/g,
  ];
  out.redirect_patterns = {};
  for (const p of patterns) {
    const m = html.match(p);
    if (m) out.redirect_patterns[p.toString()] = m.length;
  }
  // Snippet around any window.location occurrence
  const idx = html.indexOf('location');
  if (idx >= 0) out.location_snippet = html.slice(Math.max(0, idx - 80), idx + 400);

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
