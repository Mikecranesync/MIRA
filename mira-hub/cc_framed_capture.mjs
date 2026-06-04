import { chromium } from "@playwright/test";
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:3971/", { waitUntil: "domcontentloaded" });
  await p.getByText("Conveyor 1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  console.log("tree visible");
  await p.getByText("Conveyor 1", { exact: true }).first().click();
  await p.getByText(/^Live$/).waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  console.log("clicked, viewer open");
  const fr = p.frameLocator("iframe");
  let inner = "";
  for (let i = 0; i < 15; i++) {
    await p.waitForTimeout(1000);
    inner = await fr.locator("#app").innerHTML().catch(() => "");
    if (inner.length > 200) break;
  }
  console.log("FRAMED_MOUNTED:", inner.length > 200, "len:", inner.length);
  const ft = await fr.locator("body").innerText().catch(() => "");
  console.log("FRAME_TEXT:", ft.slice(0, 140).replace(/\s+/g, " "));
  await p.screenshot({ path: "/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-30_command-center-STAGING-watching_desktop.png" });
  console.log("SHOT_DONE");
} catch (e) {
  console.log("ERR:", e.message.slice(0, 200));
}
await b.close();
process.exit(0);
