import { chromium } from "@playwright/test";
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  let ws=0, frames=0;
  p.on("websocket", w=>{ ws++; w.on("framereceived",()=>frames++); });
  await p.goto("http://127.0.0.1:3991/", { waitUntil:"domcontentloaded" });
  await p.getByText("Conveyor 1",{exact:true}).waitFor({state:"visible",timeout:15000});
  // tree screenshot (green dot)
  await p.waitForTimeout(800);
  await p.screenshot({ path:"/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-31_command-center-DEV-LIVE-tree.png" });
  // click → watch
  await p.getByText("Conveyor 1",{exact:true}).first().click();
  await p.getByText(/^Live$/).waitFor({state:"visible",timeout:8000}).catch(()=>{});
  await p.waitForTimeout(12000); // let the framed dashboard + WS load
  console.log("WS_CONNS=%d FRAMES=%d", ws, frames);
  // CDP screenshot (live-socket page stalls normal screenshot)
  const s = await p.context().newCDPSession(p);
  const { data } = await s.send("Page.captureScreenshot", { format:"png" });
  const fs = await import("fs");
  fs.writeFileSync("/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-31_command-center-DEV-LIVE-watching.png", Buffer.from(data,"base64"));
  console.log("SHOT_DONE");
} catch(e){ console.log("ERR:", e.message.slice(0,150)); }
await b.close(); process.exit(0);
