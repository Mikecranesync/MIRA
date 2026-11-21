// Behavioural tests for the Industrial Intelligence Challenge review page (built dist/mike-review-v2.html),
// run against test/fake-db.js. Each guard here was shown to fail on a mutation; see ../README.md.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = fs.readFileSync(path.join(HERE, 'fake-db.js'), 'utf8');
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data.json'), 'utf8'));
const PAGE = 'mike-review-v2.local.html';
const SHOTS = path.join(HERE, '..', 'screenshots');

async function open(page, { cfg = {}, server = null, local = null, localV1 = null, waitReady = true } = {}) {
  await page.addInitScript(FAKE);
  await page.goto('pages/');      // same origin, no app script: seeding here cannot be clobbered by the app's pagehide save
  await page.evaluate(({ cfg, server, local, localV1 }) => {
    localStorage.clear();
    localStorage.setItem('__fake_cfg', JSON.stringify(cfg));
    if (server) localStorage.setItem('__fake_server', JSON.stringify(server));
    if (local) localStorage.setItem('mike-review-v2', JSON.stringify(local));
    if (localV1) localStorage.setItem('mike-review-v1', JSON.stringify(localV1));
  }, { cfg, server, local, localV1 });
  await page.goto(PAGE);
  if (waitReady) await page.waitForFunction(() => window.__review && (window.__review.S.serverReady || (window.__review.S.dbState !== 'on' && window.__review.S.dbState !== 'connecting')));
}
const st = page => page.evaluate(() => ({ xp: window.__review.progress().xp, p: window.__review.progress(), db: window.__review.S.dbState }));
const writes = page => page.evaluate(() => JSON.parse(localStorage.getItem('__fake_writes') || '[]'));
const serverDoc = (page, coll, id) => page.evaluate(([c, i]) => (JSON.parse(localStorage.getItem('__fake_server') || '{}')[c] || {})[i] || null, [coll, id]);

async function addHazards(page, n) {
  await page.getByRole('button', { name: /Start|Keep hunting/ }).first().click();
  for (let i = 0; i < n; i++) {
    await page.getByLabel('A risky question, in your words').fill(`test hazard ${i}`);
    await page.getByRole('button', { name: 'Add it' }).click();
  }
}
async function rateAllPages(page, label) {
  const cards = page.locator('.pagecard');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await card.locator('img').scrollIntoViewIfNeeded();
    await expect(card.getByRole('button', { name: label })).toBeEnabled({ timeout: 10000 });
    await card.getByRole('button', { name: label }).click();
  }
}

test('data embedded in the page is the frozen data.json and carries no AI labels or rankings', async ({ page }) => {
  await open(page);
  const embedded = await page.evaluate(() => JSON.parse(document.getElementById('data').textContent));
  expect(embedded).toEqual(DATA);
  for (const f of embedded.forum) expect(Object.keys(f).sort()).toEqual(['id', 'manual', 'manual_title', 'pages', 'question', 'url']);
  for (const s of embedded.safety) expect(Object.keys(s).sort()).toEqual(['id', 'question']);
  const scripts = await page.evaluate(() => [...document.scripts].map(s => s.textContent).join('\n') + document.body.innerText);
  for (const banned of ['expected_gate', '"accepted"', '"blind"', 'ranked_pages', 'evidence_quote', '"protect"', 'agreed']) expect(scripts).not.toContain(banned);
});

test('mobile layout: no sideways scroll and every control is a large tap target', async ({ page }, info) => {
  await open(page);
  for (const view of ['home', 'hunter']) {
    if (view === 'hunter') await page.getByRole('button', { name: 'Start' }).first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 48).map(b => b.textContent));
    expect(small).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${view}.png`), fullPage: view === 'home' });
  }
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.qtext')).fontSize));
  expect(fs1).toBeGreaterThanOrEqual(20);
});

test('Safety Sentinel stays locked until 10 hazards are written, as in v1', async ({ page }) => {
  await open(page);
  const sentinel = page.locator('section.card', { hasText: 'Safety Sentinel' });
  await expect(sentinel.getByRole('button', { name: 'Locked' })).toBeDisabled();
  await addHazards(page, 9);
  await page.getByRole('button', { name: /Missions/ }).click();
  await expect(sentinel.getByRole('button', { name: 'Locked' })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep hunting' }).click();
  await page.getByLabel('A risky question, in your words').fill('tenth');
  await page.getByRole('button', { name: 'Add it' }).click();
  await page.getByRole('button', { name: /Missions/ }).click();
  await expect(sentinel.getByRole('button', { name: 'Start' })).toBeEnabled();
});

test('XP counts only server-confirmed saves', async ({ page }) => {
  await open(page, { cfg: { latency: 2500 } });
  await addHazards(page, 1);
  expect((await st(page)).xp).toBe(0);                         // local + pending: no XP yet
  await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 8000 });
  await expect.poll(async () => (await st(page)).xp).toBe(5);
  await page.getByRole('button', { name: /Missions/ }).click();
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await rateAllPages(page, 'No');
  await page.getByRole('button', { name: 'This manual doesn\u2019t cover it' }).click();
  await page.waitForTimeout(600);
  expect((await st(page)).xp).toBe(5);                         // completed on the phone, not yet confirmed
  await expect(page.locator('#status')).toHaveText(/Saved to Claude/, { timeout: 10000 });
  await expect.poll(async () => (await st(page)).xp).toBe(15);
});

test('page buttons stay disabled until that page image has loaded and been on screen', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Start' }).nth(1).click();
  const cards = page.locator('.pagecard');
  const last = cards.nth((await cards.count()) - 1);
  await expect(last.getByRole('button', { name: 'Answers it' })).toBeDisabled();
  await last.locator('img').scrollIntoViewIfNeeded();
  await expect(last.getByRole('button', { name: 'Answers it' })).toBeEnabled({ timeout: 10000 });
});

test('a case counts only when every page and the overall question are answered; the label never changes XP', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Start' }).nth(1).click();
  await expect(page.locator('.qtext')).toHaveText(DATA.forum[0].question);   // original order
  await page.getByRole('button', { name: 'One of these pages answers it' }).click();
  await page.waitForTimeout(400);
  expect((await st(page)).p.forum).toBe(0);                    // overall alone is not a completed review
  await rateAllPages(page, 'Answers it');
  await expect.poll(async () => (await st(page)).xp).toBe(10);
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.locator('.qtext')).toHaveText(DATA.forum[1].question);
  await rateAllPages(page, 'Can’t tell');                // a different, "unsure" label
  await page.getByRole('button', { name: 'The question is too unclear to say' }).click();
  await expect.poll(async () => (await st(page)).xp).toBe(20); // same +10
});

test('interrupted save: reload before the server confirms, answer survives and reaches the server', async ({ page }, info) => {
  await open(page, { cfg: { latency: 4000 } });
  await page.getByRole('button', { name: 'Start' }).nth(1).click();
  await page.getByRole('button', { name: 'The answer is somewhere else in this manual' }).click();
  await page.reload();                                         // before the 4 s confirmation lands
  await page.waitForFunction(() => window.__review.S.serverReady);
  await page.evaluate(() => localStorage.setItem('__fake_cfg', JSON.stringify({ latency: 50 })));
  await expect.poll(() => serverDoc(page, 'answers', 'forum-' + DATA.forum[0].id).then(d => d && d.overall), { timeout: 10000 }).toBe('elsewhere');
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'The answer is somewhere else in this manual' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-detective.png`), fullPage: false });
});

test('server outage: write fails, answer kept on phone, retried and saved later', async ({ page }) => {
  await open(page, { cfg: { latency: 50, fail: { code: 'unavailable', times: 3 } } });
  await page.getByRole('button', { name: 'Start' }).nth(1).click();
  await page.getByRole('button', { name: 'This manual doesn’t cover it' }).click();
  await expect(page.locator('#status')).toHaveText(/Not saved yet/, { timeout: 8000 });
  await page.reload();
  await page.waitForFunction(() => window.__review.S.serverReady);
  await expect.poll(() => serverDoc(page, 'answers', 'forum-' + DATA.forum[0].id).then(d => d && d.overall), { timeout: 10000 }).toBe('not-in-manual');
});

test('v1 records: opening v2 writes nothing when phone and server already match', async ({ page }) => {
  const f = DATA.forum[0], s = DATA.safety[0];
  const v1 = {
    ['forum-' + f.id]: { pages: Object.fromEntries(f.pages.map(p => [p, 'no'])), overall: 'answered', note: 'v1 note', key: 'forum-' + f.id, savedAt: '2026-10-26T10:00:00.000Z' },
    ['safety-' + s.id]: { choice: 'warn', key: 'safety-' + s.id, savedAt: '2026-10-26T10:01:00.000Z' },
  };
  const haz = { id: 'hv1', text: 'v1 hazard', writtenAt: '2026-10-26T09:00:00.000Z' };
  await open(page, { server: { answers: v1, hazards: { hv1: haz } }, localV1: { answers: v1, hazards: [haz] } });
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual([]);
  expect(await serverDoc(page, 'answers', 'forum-' + f.id)).toEqual(v1['forum-' + f.id]);
  expect((await st(page)).xp).toBe(10 + 5 + 5);
});

test('an older copy on the phone never overwrites a newer server record', async ({ page }) => {
  const s = DATA.safety[0], key = 'safety-' + s.id;
  const newer = { choice: 'stop', key, savedAt: '2026-10-27T10:00:00.000Z' };
  const older = { choice: 'answer', key, savedAt: '2026-10-26T10:00:00.000Z' };
  await open(page, { server: { answers: { [key]: newer }, hazards: {} }, local: { local: { [key]: older }, localHaz: {}, tomb: {}, seen: {} } });
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual([]);
  expect(await serverDoc(page, 'answers', key)).toEqual(newer);
});

test('a viewer who may not write sees a read-only banner and earns nothing', async ({ page }) => {
  await open(page, { cfg: { readonly: true } });
  await addHazards(page, 1);
  await expect(page.getByText('This account can view but not save')).toBeVisible();
  expect((await st(page)).xp).toBe(0);
  expect(await serverDoc(page, 'hazards', 'x')).toBeNull();
});

test('quick session takes the next 5 unanswered cases in original order', async ({ page }) => {
  await open(page);
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button', { name: 'Quick 5' }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.qtext')).toHaveText(DATA.forum[i].question);
    await expect(page.getByText(`Session ${i + 1} of 5`)).toBeVisible();
    await page.getByRole('button', { name: i < 4 ? 'Next →' : 'Finish session' }).click();
  }
  await expect(page.getByText('Session complete')).toBeVisible();
});

test('summary and badges never compare answers with anything', async ({ page }, info) => {
  await open(page);
  await addHazards(page, 1);
  await page.getByRole('button', { name: /Missions/ }).click();
  await page.getByRole('button', { name: 'See summary' }).click();
  const text = await page.locator('#app').innerText();
  for (const w of ['correct', 'accuracy', 'agree', 'right answer', 'wrong']) expect(text.toLowerCase()).not.toContain(w);
  await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-summary.png`) });
});

const savedCase = () => {
  const f = DATA.forum[0], key = 'forum-' + f.id;
  return { f, key, rec: { pages: Object.fromEntries(f.pages.map(p => [p, 'yes'])), overall: 'answered', note: 'expert note', key, savedAt: '2026-10-26T08:00:00.000Z' } };
};

test('Codex F1: an edit cannot be made before the first sync, and never wipes saved page ratings or notes', async ({ page }) => {
  const { f, key, rec } = savedCase();
  await open(page, { cfg: { snapshotDelay: 3000 }, server: { answers: { [key]: rec }, hazards: {} }, waitReady: false });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await expect(page.getByText('Loading your saved answers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'The answer is somewhere else in this manual' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'The answer is somewhere else in this manual' })).toBeEnabled({ timeout: 10000 });
  await page.getByRole('button', { name: 'The answer is somewhere else in this manual' }).click();
  await expect.poll(() => serverDoc(page, 'answers', key).then(d => d && d.overall)).toBe('elsewhere');
  const d = await serverDoc(page, 'answers', key);
  expect(d.pages).toEqual(rec.pages);
  expect(d.note).toBe('expert note');
});

test('Codex F1: an edit made while offline merges into the saved record instead of replacing it', async ({ page }) => {
  const { key, rec } = savedCase();
  await open(page, { cfg: { noDb: true }, server: { answers: { [key]: rec }, hazards: {} } });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'The question is too unclear to say' }).click();
  await page.evaluate(() => localStorage.setItem('__fake_cfg', JSON.stringify({ latency: 50 })));
  await page.reload();
  await page.waitForFunction(() => window.__review.S.serverReady);
  await expect.poll(() => serverDoc(page, 'answers', key).then(d => d && d.overall)).toBe('unclear');
  const d = await serverDoc(page, 'answers', key);
  expect(d.pages).toEqual(rec.pages);
  expect(d.note).toBe('expert note');
});

test('Codex F2: a removed hazard stays removed across reloads', async ({ page }) => {
  await open(page);
  await addHazards(page, 1);
  await expect(page.getByText('Saved \u2713')).toBeVisible({ timeout: 8000 });
  const id = await page.evaluate(() => Object.keys(window.__review.S.localHaz)[0]);
  await page.getByRole('button', { name: 'Remove this question' }).click();
  await expect.poll(() => serverDoc(page, 'hazards', id)).toBeNull();
  for (let i = 0; i < 2; i++) { await page.reload(); await page.waitForFunction(() => window.__review.S.serverReady && window.__review.S.hazReady); await page.waitForTimeout(500); }
  expect(await serverDoc(page, 'hazards', id)).toBeNull();
  const log = (await writes(page)).filter(w => w.id === id);
  expect(log.map(w => w.op)).toEqual(['set', 'delete']);
  expect((await st(page)).p.hazards).toBe(0);
});

test('Codex round 2 F1: an offline choice identical to the saved one, then a later change, keeps every saved field', async ({ page }) => {
  const { key, rec } = savedCase();
  await open(page, { cfg: { noDb: true }, server: { answers: { [key]: rec }, hazards: {} } });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'One of these pages answers it' }).click();     // same as the saved overall
  await page.evaluate(() => localStorage.setItem('__fake_cfg', JSON.stringify({ latency: 50 })));
  await page.reload();
  await page.waitForFunction(() => window.__review.S.serverReady);
  const afterSync = await page.evaluate(k => JSON.parse(localStorage.getItem('mike-review-v2')).local[k], key);
  expect(afterSync.pages).toEqual(rec.pages);                 // the phone copy is the merged record, even with no write
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await page.getByRole('button', { name: '\u2190 Back' }).click();   // case 1 is now complete, so Continue opened case 2
  await expect(page.locator('.qtext')).toHaveText(DATA.forum[0].question);
  await page.getByRole('button', { name: 'The answer is somewhere else in this manual' }).click();
  await expect.poll(() => serverDoc(page, 'answers', key).then(d => d && d.overall)).toBe('elsewhere');
  const d = await serverDoc(page, 'answers', key);
  expect(d.pages).toEqual(rec.pages);
  expect(d.note).toBe('expert note');
  const local = await page.evaluate(k => JSON.parse(localStorage.getItem('mike-review-v2')).local[k], key);
  expect(local.pages).toEqual(rec.pages);
});

test('Codex round 2 F4: finishing a quick session before the first sync arrives does not blank the page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page, { cfg: { snapshotDelay: 5000 }, waitReady: false });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button', { name: 'Quick 5' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next →' }).click();
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText('Session complete')).toBeVisible();
  await page.waitForFunction(() => window.__review.S.serverReady, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  await expect(page.getByText('Session complete')).toBeVisible();
  await page.getByRole('button', { name: 'Back to missions' }).click();
  await expect(page.getByRole('heading', { name: 'Industrial Intelligence Challenge' })).toBeVisible();
});

test('a save never drops a field that the server copy holds, even if the phone copy lacks it', async ({ page }) => {
  const { key, rec } = savedCase();
  await open(page, { server: { answers: { [key]: rec }, hazards: {} } });
  await page.evaluate(k => {
    const R = window.__review;
    R.S.local[k] = { overall: 'answered', key: k, savedAt: '2026-10-26T07:00:00.000Z' };   // a stripped phone copy, older than the server's
    R.saveAnswer(k, r => { r.overall = 'unclear'; });
  }, key);
  await expect.poll(() => serverDoc(page, 'answers', key).then(d => d && d.overall)).toBe('unclear');
  const d = await serverDoc(page, 'answers', key);
  expect(d.pages).toEqual(rec.pages);
  expect(d.note).toBe('expert note');
});

test('#4802: a failed first load shows Try again, keeps answers locked, and recovers with saved fields intact', async ({ page }) => {
  const { key, rec } = savedCase();
  await open(page, { cfg: { subError: { code: 'unavailable', times: 2 } }, server: { answers: { [key]: rec }, hazards: {} }, waitReady: false });
  await expect(page.getByText('Couldn\u2019t load your saved answers')).toBeVisible({ timeout: 5000 });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'The answer is somewhere else in this manual' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'The answer is somewhere else in this manual' })).toBeEnabled({ timeout: 10000 });
  await expect(page.getByText('Couldn\u2019t load your saved answers')).toHaveCount(0);
  await page.getByRole('button', { name: 'The answer is somewhere else in this manual' }).click();
  await expect.poll(() => serverDoc(page, 'answers', key).then(d => d && d.overall)).toBe('elsewhere');
  const d = await serverDoc(page, 'answers', key);
  expect(d.pages).toEqual(rec.pages);
  expect(d.note).toBe('expert note');
});

test('#4803: the session summary count updates when pending saves confirm', async ({ page }) => {
  await open(page, { cfg: { latency: 3000 } });
  await page.locator('section.card', { hasText: 'Manual Detective' }).getByRole('button', { name: 'Quick 5' }).click();
  await rateAllPages(page, 'No');
  await page.getByRole('button', { name: 'This manual doesn\u2019t cover it' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next \u2192' }).click();
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: '0 of 5 saved' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 of 5 saved' })).toBeVisible({ timeout: 10000 });
});

test('#4802: a hazards-only load failure is shown and recovers, so hazard progress is not silently undercounted', async ({ page }) => {
  const haz = { hx: { id: 'hx', text: 'saved hazard', writtenAt: '2026-10-26T09:00:00.000Z' } };
  await open(page, { cfg: { subError: { code: 'unavailable', times: 1, coll: 'hazards' } }, server: { answers: {}, hazards: haz }, waitReady: false });
  await expect(page.getByText('Couldn\u2019t load your saved answers')).toBeVisible({ timeout: 5000 });
  expect((await st(page)).p.hazards).toBe(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(async () => (await st(page)).p.hazards, { timeout: 10000 }).toBe(1);
  await expect(page.getByText('Couldn\u2019t load your saved answers')).toHaveCount(0);
});
