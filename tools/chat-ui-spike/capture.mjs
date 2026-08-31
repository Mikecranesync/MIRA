/** Capture device evidence frames via CDP (adb screencap can be
 *  black on emulators). Saves to docs/promo-screenshots/ per the Screenshot Rule. */
import { CDP, sleep } from "../mobile-e2e/cdp.mjs";
import { writeFileSync } from "node:fs";

const OUT = "../../docs/promo-screenshots";
const c = await CDP.attach();

const shot = async (name) => {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  console.log("saved", name);
};
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
  throw new Error(`setCheck ${id}`);
};
const ask = async (t) => {
  await c.evaluate((text) => {
    const ta = [...document.querySelectorAll("textarea")].find((e) =>
      (e.placeholder || "").startsWith("Ask about"));
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
  await sleep(200);
  await c.evaluate(() => document.querySelector('[data-testid="send"]')?.click());
};

await c.evaluate(() => location.reload());
await sleep(6000);
await shot("2026-08-30_chat-spike-persisted-thread-hydrated_android");

await setCheck("live-toggle", true);
await setCheck("xorigin-toggle", false);
await ask("same origin streaming");
await sleep(1400);
await shot("2026-08-30_chat-spike-same-origin-incremental-midstream_android");
await sleep(3000);

await ask("stop me mid stream");
await sleep(1200);
await c.evaluate(() => document.querySelector('[data-testid="stop"]')?.click());
await sleep(1200);
await shot("2026-08-30_chat-spike-stop-partial-server-cancelled_android");

await setCheck("xorigin-toggle", true);
await ask("cross origin buffered");
await sleep(1400);
await shot("2026-08-30_chat-spike-cross-origin-buffered-nothing-yet_android");
await sleep(3500);
await shot("2026-08-30_chat-spike-cross-origin-one-chunk-arrived_android");

await c.close();
