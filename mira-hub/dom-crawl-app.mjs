import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://app.factorylm.com';
const urls = [
  BASE + '/login/',
  BASE + '/signup',
  BASE + '/pricing',
  BASE + '/blog/fault-codes',
];

const DOM_EVAL = () => {
  const r = { url: location.href };
  const imgs = [...document.querySelectorAll('img')];
  r.images_total = imgs.length;
  r.images_no_alt = imgs.filter(i => !i.hasAttribute('alt')).map(i => i.src);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  r.h1_count = headings.filter(h => h.tagName === 'H1').length;
  const order = headings.map(h => +h.tagName.slice(1));
  r.heading_skips = order.map((n,i) => i>0 && n-order[i-1]>1 ? `h${order[i-1]}->h${n}` : null).filter(Boolean);
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
  };
  r.external_no_noopener = [...document.querySelectorAll('a[target="_blank"]')]
    .filter(a => !(a.rel||'').includes('noopener')).map(a => a.href);
  r.mixed_content = [...document.querySelectorAll('img,script,link,iframe')]
    .map(e => e.src||e.href).filter(u => u && u.startsWith('http://')).slice(0,10);
  r.tap_targets_too_small = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width>0 && b.height>0 && (b.width<44||b.height<44); })
    .map(el => ({ tag: el.tagName, text: (el.innerText||el.value||'').slice(0,40), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
    .slice(0,15);
  r.buttons_no_name = [...document.querySelectorAll('button')]
    .filter(b => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  r.forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action, method: f.method,
    inputs_unlabelled: [...f.querySelectorAll('input,textarea,select')]
      .filter(i => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).length,
  }));
  r.jsonld_types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
    try { const o = JSON.parse(s.textContent); return o['@type']||(o['@graph']||[]).map(x=>x['@type'])||'unknown'; }
    catch { return 'INVALID_JSON'; }
  });
  return r;
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const results = [];

  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    const networkFails = [];
    page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
    page.on('response', r => { if (r.status()>=400) networkFails.push({ url: r.url(), status: r.status() }); });

    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => ({ status: () => 'timeout', url: () => url }));
    const finalUrl = page.url();
    const dom = await page.evaluate(DOM_EVAL);

    // Mobile pass
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileErrors = [];
    page.on('console', m => { if (m.type()==='error') mobileErrors.push(m.text()); });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const mobileTap = await page.evaluate(() =>
      [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
        .filter(el => { const b = el.getBoundingClientRect(); return b.width>0 && b.height>0 && (b.width<44||b.height<44); })
        .map(el => ({ tag: el.tagName, text: (el.innerText||el.value||'').slice(0,30), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
        .slice(0,15)
    );

    // Tab focus
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focusedEl = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, text: (el.innerText||el.value||'').slice(0,40) } : null;
    });

    results.push({ url, finalUrl, dom, mobileTap, consoleErrors, mobileErrors, networkFails, focusedEl });
    await page.close();
  }

  await browser.close();
  writeFileSync('/tmp/dom-app.json', JSON.stringify(results, null, 2));
  console.log('Done. Pages:', results.length);
  results.forEach(r => {
    console.log(`\n=== ${r.url} ==> ${r.finalUrl} ===`);
    console.log(`  h1: ${r.dom.h1_count}  imgs_no_alt: ${r.dom.images_no_alt.length}  tap_small(desktop): ${r.dom.tap_targets_too_small.length}  tap_small(mobile): ${r.mobileTap.length}`);
    console.log(`  heading_skips: ${JSON.stringify(r.dom.heading_skips)}`);
    console.log(`  title: ${r.dom.meta.title}`);
    console.log(`  canonical: ${r.dom.meta.canonical}`);
    console.log(`  og_image: ${r.dom.meta.og_image}  twitter: ${r.dom.meta.twitter_card}`);
    console.log(`  jsonld: ${JSON.stringify(r.dom.jsonld_types)}`);
    console.log(`  forms: ${JSON.stringify(r.dom.forms)}`);
    console.log(`  consoleErrors(${r.consoleErrors.length}): ${r.consoleErrors.slice(0,3).join(' | ')}`);
    console.log(`  networkFails: ${JSON.stringify(r.networkFails.slice(0,5))}`);
    console.log(`  focus: ${JSON.stringify(r.focusedEl)}`);
    console.log(`  buttons_no_name: ${r.dom.buttons_no_name}`);
    console.log(`  external_no_noopener: ${r.dom.external_no_noopener.length}`);
  });
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
