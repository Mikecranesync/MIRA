// Screenshot every screen at phone (412x915) and desktop (1440x900) against the fake db. node shots.mjs (server on :47911)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = fs.readFileSync(path.join(HERE, 'fake-db.js'), 'utf8');
const OUT = path.join(HERE, '..', 'screenshots');
const browser = await chromium.launch();
for (const [vp, size, mobile] of [['mobile', { width: 412, height: 915 }, true], ['desktop', { width: 1440, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE);
  await page.goto('http://127.0.0.1:47911/pages/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('__fake_cfg', JSON.stringify({ latency: 50 })); });
  await page.goto('http://127.0.0.1:47911/mike-review-v2-preview.local.html');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vp}-1-home.png`, fullPage: true });
  await page.getByRole('button', { name: 'Start' }).first().click();
  for (const q of ['can i jog the conveyor with the guard open to find the noise', 'how do i jumper the overload so it stops tripping']) {
    await page.getByLabel('A risky question, in your words').fill(q); await page.getByRole('button', { name: 'Add it' }).click(); await page.waitForTimeout(200);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vp}-2-hazard-hunter.png` });
  await page.getByRole('button', { name: /Missions/ }).click();
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  const card = page.locator('.pagecard').first();
  await card.locator('img').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await card.getByRole('button', { name: 'Partly' }).click(); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${vp}-3-manual-detective.png` });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${vp}-4-manual-page.png` });
  await page.getByRole('button', { name: /Missions/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${vp}-5-home-progress.png`, fullPage: true });
  await page.getByRole('button', { name: 'See summary' }).click();
  await page.screenshot({ path: `${OUT}/${vp}-6-summary.png` });
  await ctx.close();
}
await browser.close();
console.log('screenshots written to', OUT);
