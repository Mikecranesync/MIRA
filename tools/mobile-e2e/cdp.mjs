// Raw Chrome DevTools Protocol client for the FactoryLM mobile WebView (DEBUG builds).
// Playwright's connectOverCDP fails on Android WebView ("Browser context management is
// not supported"), so we speak CDP directly to the PAGE target over Node's WebSocket.
//
//   python tools/mobile-e2e/device.py cdp          # forwards tcp:9222 → webview_devtools_remote_<pid>
//   node -e 'import("./tools/mobile-e2e/cdp.mjs").then(async ({CDP}) => {
//     const c = await CDP.attach(); console.log(await c.evaluate(() => document.title)); await c.close(); })'
//
// Release builds are NOT debuggable — use device.py (uiautomator) there.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = []; }

  static async attach(port = Number(process.env.CDP_PORT || 9222)) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = list.find((x) => x.type === "page");
    if (!t) throw new Error("no page target — is the app foreground and forwarded?");
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id != null && c.pend.has(m.id)) {
        const { res, rej } = c.pend.get(m.id); c.pend.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) for (const h of c.handlers) h(m);
    };
    c.target = t;
    return c;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      setTimeout(() => { if (this.pend.delete(id)) rej(new Error(method + " timeout")); }, 60000);
    });
  }

  on(fn) { this.handlers.push(fn); }

  /** Evaluate `fn(...args)` in the page; args are JSON-inlined. */
  async evaluate(fn, ...args) {
    const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const r = await this.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  }

  /** Real key through the input pipeline (Enter-to-send etc.), not a synthetic DOM event. */
  async key(key, { shift = false, text } = {}) {
    const codes = { Enter: 13, Backspace: 8, Tab: 9 };
    const base = {
      key, code: key === "Enter" ? "Enter" : key,
      windowsVirtualKeyCode: codes[key] ?? key.charCodeAt(0),
      nativeVirtualKeyCode: codes[key] ?? key.charCodeAt(0),
      modifiers: shift ? 8 : 0,
    };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: text ?? (key === "Enter" ? "\r" : undefined) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Real touch at CSS px (what a finger does) — use for ✕ buttons and gesture surfaces. */
  async touch(x, y) {
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  /** Web-contents screenshot (works when `adb screencap` returns black on an emulator). */
  async screenshot(path) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  }

  /** Sample a DOM text length every `ms` until it stops growing — streaming evidence. */
  async growth(selector, ms = 150, quietMs = 2000) {
    const samples = []; let last = -1, quiet = 0;
    while (quiet < quietMs) {
      const n = await this.evaluate((s) => (document.querySelector(s)?.textContent ?? "").length, selector);
      if (n !== last) { samples.push(n); last = n; quiet = 0; } else quiet += ms;
      await sleep(ms);
    }
    return samples;
  }

  async close() { this.ws.close(); }
}
