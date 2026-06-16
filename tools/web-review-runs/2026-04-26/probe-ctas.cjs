const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const out = {};

  // Landing — find "Join the Beta" CTA and check destination
  await page.goto('https://factorylm.com/', { waitUntil: 'networkidle' });
  out.landing_anchors = await page.evaluate(() => {
    return [...document.querySelectorAll('a')].map(a => ({
      text: (a.innerText || '').trim().slice(0, 80),
      href: a.href,
      classes: a.className,
    })).filter(a => a.text);
  });

  // Pricing — verify ALL CTAs and Stripe linkage
  await page.goto('https://factorylm.com/pricing', { waitUntil: 'networkidle' });
  out.pricing_anchors = await page.evaluate(() => {
    return [...document.querySelectorAll('a,button')].map(el => ({
      tag: el.tagName,
      text: (el.innerText || el.value || '').trim().slice(0, 100),
      href: el.href || null,
      onclick: !!el.onclick,
      classes: el.className,
    })).filter(a => a.text);
  });
  out.pricing_html_for_cta_section = await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h1,h2,h3')];
    return headings.map(h => h.innerText.trim()).slice(0, 20);
  });

  // CMMS — inspect that form
  await page.goto('https://factorylm.com/cmms', { waitUntil: 'networkidle' });
  out.cmms_form = await page.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return null;
    return {
      action: f.action, method: f.method,
      html: f.outerHTML.slice(0, 1500),
      inputs: [...f.querySelectorAll('input,textarea,select,button')].map(i => ({
        tag: i.tagName, type: i.type, name: i.name, placeholder: i.placeholder,
        labelled_by: i.getAttribute('aria-labelledby'), label: i.getAttribute('aria-label'),
        has_label_el: !!i.labels?.length,
      })),
    };
  });
  out.cmms_anchors_with_signup_intent = await page.evaluate(() => {
    return [...document.querySelectorAll('a')].filter(a => {
      const t = (a.innerText || '').toLowerCase();
      return /(beta|sign|start|trial|try|book|demo|buy|checkout)/.test(t);
    }).map(a => ({ text: a.innerText.trim().slice(0,80), href: a.href }));
  });

  // /activated — what does the URL resolve to in HTML (not the redirect)
  // Use HEAD/raw fetch to avoid the redirect
  await page.goto('https://factorylm.com/activated', { waitUntil: 'networkidle' });
  out.activated_final = page.url();
  out.activated_h1 = await page.evaluate(() => {
    const h = document.querySelector('h1');
    return h ? h.innerText.trim() : null;
  });
  // also check what /activated raw HTML returns before any client-side route handles it
  // We need to fetch with raw HTTP
  const respRaw = await page.context().request.get('https://factorylm.com/activated', { maxRedirects: 0 });
  out.activated_raw_status = respRaw.status();
  out.activated_raw_location = respRaw.headers()['location'] || null;
  out.activated_raw_body_first_500 = (await respRaw.text()).slice(0, 500);

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
