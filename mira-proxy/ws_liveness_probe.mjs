// WS liveness probe — confirms LIVE data frames flow through the proxy, not just
// that the handshake upgrades. Connects socket.io (EIO4) over WS THROUGH the proxy
// and waits for actual message frames from the dashboard. This is the goal prompt's
// "values update in real time" make-or-break check.
import WebSocket from "ws";

const PROXY = process.env.PROXY || "ws://127.0.0.1:8889";
const DID = process.env.DID || "e0690a31-eec5-4da3-b738-8d10c06b266c";

// 1) socket.io polling handshake to get a session id (over http through the proxy).
const httpBase = PROXY.replace(/^ws/, "http");
const hs = await fetch(`${httpBase}/display/${DID}/dashboard/socket.io/?EIO=4&transport=polling`);
const hsText = await hs.text();
const sid = JSON.parse(hsText.replace(/^0/, "")).sid;
console.log("handshake sid:", sid);

// 2) upgrade to WS through the proxy, carrying the sid.
const url = `${PROXY}/display/${DID}/dashboard/socket.io/?EIO=4&transport=websocket&sid=${sid}`;
const ws = new WebSocket(url);

let frames = 0;
let dataFrames = 0;
const got = [];
ws.on("open", () => {
  console.log("WS OPEN through proxy");
  ws.send("2probe"); // EIO4 upgrade probe
  ws.send("5");      // EIO4 upgrade confirm
});
ws.on("message", (m) => {
  const s = m.toString();
  frames++;
  // socket.io event frames start with 42 (EVENT). Those carry the live values.
  if (s.startsWith("42")) { dataFrames++; got.push(s.slice(0, 80)); }
});
ws.on("error", (e) => console.log("WS ERROR:", String(e).slice(0, 120)));

// Listen for ~10s, then report.
await new Promise((r) => setTimeout(r, 10000));
console.log(`FRAMES_TOTAL=${frames} DATA_FRAMES=${dataFrames}`);
got.slice(0, 3).forEach((g) => console.log("  data:", g));
console.log(dataFrames > 0 ? "LIVE_DATA_THROUGH_PROXY=yes" : "LIVE_DATA_THROUGH_PROXY=no");
ws.close();
process.exit(0);
