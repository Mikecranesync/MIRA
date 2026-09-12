/** STRM-2 invariant under Stop, swept across the stream, on a device WebView.
 *  Invariant (PRD §10.9 / STRM-2): a stopped turn keeps the partial text and
 *  carries NO citations, NO basis, and a stopped caption — and the server
 *  must record the cancellation. */
import { CDP, sleep } from "../mobile-e2e/cdp.mjs";

const STATUS = "http://localhost:3000/hub/labs/chat-spike/stream/";
const truth = async () => (await fetch(STATUS)).json();
const c = await CDP.attach();

const setCheck = async (id, on) => {
  for (let i = 0; i < 20; i++) {
    const got = await c.evaluate((tid, want) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) return "missing";
      if (el.checked !== want) el.click();
      return el.checked;
    }, id, on);
    if (got === on) return;
    await sleep(300);
  }
  throw new Error("setCheck " + id);
};
const ask = async (t) => {
  await c.evaluate((text) => {
    const ta = [...document.querySelectorAll("textarea")].find((e) =>
      (e.placeholder || "").startsWith("Ask about"));
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    s.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
  await sleep(150);
  await c.evaluate(() => document.querySelector('[data-testid="send"]')?.click());
};
/** Inspect ONLY the last assistant turn. */
const lastTurn = () =>
  c.evaluate(() => {
    const m = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
    if (!m) return null;
    return {
      chips: m.querySelectorAll('[data-testid="source-chip"]').length,
      basis: m.querySelectorAll('[data-testid="basis-badge"]').length,
      stoppedCaption: m.querySelectorAll('[data-testid="stopped-caption"]').length,
      text: m.innerText.replace(/\s+/g, " ").trim().slice(0, 70),
      running: !!document.querySelector('[data-testid="stop"]'),
    };
  });

await c.evaluate(() => location.reload());
await sleep(6000);
await setCheck("live-toggle", true);
await setCheck("xorigin-toggle", false);

const rows = [];
for (let run = 1; run <= 5; run++) {
  const waitMs = 400 + run * 250; // sweep the stop moment across the stream
  await ask(`strm2 run ${run}`);
  await sleep(waitMs);
  const chunksAtStop = await c.evaluate(() => {
    const el = document.querySelector('[data-testid="chunk-count"]');
    return el ? Number(el.textContent.replace(/\D/g, "")) : null;
  });
  const wasRunning = await c.evaluate(() => !!document.querySelector('[data-testid="stop"]'));
  const srvPre = (await truth()).last.framesSent;
  await c.evaluate(() => document.querySelector('[data-testid="stop"]')?.click());
  await sleep(1600);
  const t = await lastTurn();
  const srv = (await truth()).last;
  // Frame order on this route: content×3 (1-3), sources (4), evidence (5),
  // usage (6), STATUS (7), followups (8), [DONE] (9). Once the client has the
  // `status` frame the turn IS terminally answered, so rendering the cited
  // answer is correct even though the user pressed Stop — the abort merely
  // landed in the tail. A VIOLATION is showing citations/basis when the
  // status frame had NOT yet been sent.
  const STATUS_FRAME_INDEX = 7;
  const hadStatus = srvPre >= STATUS_FRAME_INDEX;
  const violation = wasRunning && !hadStatus && (t.chips > 0 || t.basis > 0 || t.stoppedCaption === 0);
  rows.push({
    run, waitMs, chunksAtStop, wasRunning,
    chips: t.chips, basis: t.basis, stoppedCaption: t.stoppedCaption,
    serverCancelled: srv.cancelled, serverFrames: `${srv.framesSent}/${srv.totalFrames}`,
    srvPre, hadStatus,
    VERDICT: !wasRunning
      ? "n/a (already finished)"
      : violation
        ? "STRM-2 VIOLATION"
        : hadStatus && srv.cancelled
          ? "ok (TAIL RACE: client answered, server logged cancelled)"
          : "ok",
    text: t.text,
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
  await sleep(800);
}
console.log("\nviolations:", rows.filter((r) => r.VERDICT === "STRM-2 VIOLATION").length);
await c.close();
