/**
 * Emulator/device pass for the ChatGPT-class UI compatibility spike. Drives the Capacitor WebView over CDP so numbers are
 * exact rather than read off screenshots.
 *
 * Prereqs: emulator running the debug spike shell, `adb reverse tcp:3000`,
 * `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`,
 * hub dev server on :3000.
 */
import { CDP, sleep } from "../mobile-e2e/cdp.mjs";

const STATUS = "http://localhost:3000/hub/labs/chat-spike/stream/";
const serverTruth = async () => (await fetch(STATUS)).json();

const c = await CDP.attach();
const results = [];
const record = (name, verdict, detail) => {
  results.push({ name, verdict, detail });
  console.log(`${verdict.padEnd(7)} | ${name} | ${detail}`);
};

const ready = () => c.evaluate(() => !!document.querySelector('[data-testid="send"], [data-testid="stop"]'));
/** Wait for a testid to exist (conditional subtrees need a React render pass). */
async function waitFor(id, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const there = await c.evaluate(
      (tid) => !!document.querySelector(`[data-testid="${tid}"]`), id,
    );
    if (there) return true;
    await sleep(300);
  }
  throw new Error(`waitFor(${id}) timed out`);
}

/** Click a checkbox and VERIFY it stuck (React controlled inputs can no-op). */
async function setCheck(id, on) {
  await waitFor(id);
  for (let i = 0; i < 5; i++) {
    const got = await c.evaluate((tid, want) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) return "missing";
      if (el.checked !== want) el.click();
      return el.checked;
    }, id, on);
    if (got === on) return got;
    await sleep(300);
  }
  throw new Error(`setCheck(${id},${on}) never took effect`);
}

/** Type into the COMPOSER (selected by placeholder — the page has >1 textarea)
 *  through React's value setter, send, and verify a new turn appeared. */
async function ask(text) {
  const before = await c.evaluate(
    () => document.querySelectorAll('[data-testid="assistant-message"]').length,
  );
  const typed = await c.evaluate((t) => {
    const ta = [...document.querySelectorAll("textarea")].find((e) =>
      (e.placeholder || "").startsWith("Ask about"),
    );
    if (!ta) return "no-composer";
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value",
    ).set;
    setter.call(ta, t);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value;
  }, text);
  if (typed !== text) throw new Error(`compose failed: ${typed}`);
  await sleep(200);
  await c.evaluate(() => document.querySelector('[data-testid="send"]')?.click());
  for (let i = 0; i < 20; i++) {
    const now = await c.evaluate(
      () => document.querySelectorAll('[data-testid="assistant-message"]').length,
    );
    if (now > before) return;
    await sleep(200);
  }
  throw new Error("send produced no new assistant turn");
}

const snapshot = () =>
  c.evaluate(() => {
    const msgs = [...document.querySelectorAll('[data-testid="assistant-message"]')];
    const last = msgs[msgs.length - 1];
    const chunkEl = document.querySelector('[data-testid="chunk-count"]');
    return {
      chunks: chunkEl ? Number(chunkEl.textContent.replace(/\D/g, "")) : null,
      text: last ? last.innerText.trim() : "",
      len: last ? last.innerText.trim().length : 0,
      running: !!document.querySelector('[data-testid="stop"]'),
      msgCount: msgs.length,
    };
  });

await c.evaluate(() => location.reload());
await sleep(5000);
for (let i = 0; i < 30 && !(await ready()); i++) await sleep(500);
// Count console errors for the whole run (PRD §17 / spike "0 console errors").
await c.send("Runtime.enable").catch(() => {});
let consoleErrors = 0;
c.on((m) => {
  if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") consoleErrors += 1;
  if (m.method === "Runtime.exceptionThrown") consoleErrors += 1;
});

// ---- Criterion 1: persisted-thread hydration on device -------------------
{
  const s = await c.evaluate(() => {
    const t = document.body.innerText;
    return {
      citationChips: document.querySelectorAll('[data-testid="source-chip"]').length,
      machineCards: document.querySelectorAll('[data-testid="machine-evidence-card"]').length,
      stopped: document.querySelectorAll('[data-testid="stopped-caption"]').length,
      abstain: t.includes("couldn't find that in the selected sources"),
      recordedLabel: t.includes("Recorded machine history"),
      live: /\bLive\b(?!\s*SSE)/.test(t),
    };
  });
  const ok = s.citationChips >= 3 && s.machineCards === 1 && s.stopped === 1 && s.abstain && s.recordedLabel && !s.live;
  record("C1 hydrate persisted thread", ok ? "PASS" : "FAIL", JSON.stringify(s));
}

// ---- Criterion 3/5 same-origin: incremental + real abort ------------------
await setCheck("live-toggle", true);
await setCheck("xorigin-toggle", false);
{
  await ask("emulator same-origin");
  const samples = [];
  for (let i = 0; i < 14; i++) {
    samples.push(await snapshot());
    await sleep(300);
  }
  await sleep(1200);
  const fin = await snapshot();
  const truth = await serverTruth();
  // Incremental = the transport delivered >1 chunk AND the rendered text grew
  // through several intermediate sizes. The distinct-length count is bounded
  // by the 300 ms poll against 250 ms frames, so it undercounts real growth;
  // >=3 distinct sizes is unambiguous partial rendering (buffered = exactly 2:
  // "" then the whole answer).
  const grew = new Set(samples.map((s) => s.len)).size >= 3;
  record(
    "C3 same-origin incremental",
    fin.chunks > 1 && grew ? "PASS" : "FAIL",
    `finalChunks=${fin.chunks} distinctLens=${new Set(samples.map((s) => s.len)).size} server=${truth.last.framesSent}/${truth.last.totalFrames}`,
  );
}
{
  await ask("emulator stop me");
  await sleep(1100);
  const mid = await snapshot();
  await c.evaluate(() => document.querySelector('[data-testid="stop"]')?.click());
  await sleep(1500);
  const truth = await serverTruth();
  const after = await c.evaluate(() => ({
    stopped: !!document.querySelector('[data-testid="stopped-caption"]'),
    chips: document.querySelectorAll('[data-testid="source-chip"]').length,
  }));
  record(
    "C5 same-origin Stop reaches server",
    truth.last.cancelled && truth.last.framesSent < truth.last.totalFrames ? "PASS" : "FAIL",
    `server cancelled=${truth.last.cancelled} framesSent=${truth.last.framesSent}/${truth.last.totalFrames} midChunks=${mid.chunks} stoppedCaption=${after.stopped}`,
  );
}

// ---- Cross-origin control: the CapacitorHttp patch ------------------------
await setCheck("xorigin-toggle", true);
{
  await ask("emulator cross-origin");
  const samples = [];
  for (let i = 0; i < 14; i++) {
    samples.push(await snapshot());
    await sleep(300);
  }
  await sleep(1500);
  const fin = await snapshot();
  const truth = await serverTruth();
  record(
    "X-ORIGIN buffered (patch)",
    fin.chunks === 1 ? "PASS" : "DIFFERS",
    `finalChunks=${fin.chunks} server=${truth.last.framesSent}/${truth.last.totalFrames} lenTrace=${samples.map((s) => s.len).join(",")}`,
  );
}
{
  await ask("emulator cross-origin stop");
  await sleep(1000);
  const before = await serverTruth();
  await c.evaluate(() => document.querySelector('[data-testid="stop"]')?.click());
  await sleep(2500);
  const truth = await serverTruth();
  record(
    "X-ORIGIN Stop honesty",
    "INFO",
    `server cancelled=${truth.last.cancelled} framesSent=${truth.last.framesSent}/${truth.last.totalFrames} (abort ${truth.last.cancelled ? "REACHED" : "did NOT reach"} server)`,
  );
  void before;
}

// ---- Unknown-frame tolerance + dark mode ---------------------------------
await setCheck("live-toggle", false);
{
  await ask("unknown frame please");
  await sleep(5000);
  const s = await c.evaluate(() => ({
    unknown: document.querySelectorAll('[data-testid="unknown-part"]').length,
    bodyHasText: document.body.innerText.includes("Answer text."),
  }));
  record("C4 unknown frame inspectable", s.unknown >= 1 && s.bodyHasText ? "PASS" : "FAIL", JSON.stringify(s));
  record("Console errors during run", consoleErrors === 0 ? "PASS" : "FAIL", `count=${consoleErrors}`);
}
{
  const dark = await c.evaluate(() => {
    document.documentElement.classList.add("dark");
    const cs = getComputedStyle(document.body);
    const out = { bg: cs.backgroundColor, fg: cs.color };
    document.documentElement.classList.remove("dark");
    return out;
  });
  record("Dark-mode tokens resolve", dark.bg && dark.fg ? "INFO" : "FAIL", JSON.stringify(dark));
}

console.log("\n=== SUMMARY ===");
for (const r of results) console.log(`${r.verdict.padEnd(7)} ${r.name}`);
await c.close();
