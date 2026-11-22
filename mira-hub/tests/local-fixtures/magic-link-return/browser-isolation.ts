/**
 * TEST ONLY. A fresh, signed-out browser context that can reach exactly one
 * origin, for the magic-link return fixture (#5753, #5798).
 *
 * A route handler is not enough: Playwright runs it once per request, and
 * Chromium follows the redirect hops of a request the handler continued (or
 * fulfilled with a 3xx) without calling it again (#5798). So the wall is the
 * browser's network stack, which applies its proxy rule to every hop: the
 * context sends every request through a local refusal proxy except requests
 * to the one allowed host and port, so another local port is proxied too.
 * Playwright already turns off Chromium's implicit loopback bypass for a
 * context proxy; `<-loopback>` only states it (removing it changes no test
 * result). The proxy forwards nothing: it records the destination and drops
 * the connection.
 *
 * `attempted` and `paths` come from the context's `request` event, which fires
 * for every request including each redirect hop, independently of the proxy.
 * Service workers are blocked so none can answer a request out of sight.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import * as http from "node:http";
import type { AddressInfo, Socket } from "node:net";

export interface IsolatedContext {
  context: BrowserContext;
  page: Page;
  /** Every refused destination (origin + path). */
  blocked: string[];
  /** Every path requested on the allowed origin, redirect hops included. */
  paths: string[];
  /** Every URL the browser asked for, recorded independently of the proxy. */
  attempted: string[];
  /** Closes the context and the refusal proxy. */
  close(): Promise<void>;
}

function originAndPath(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + url.pathname;
  } catch {
    return raw;
  }
}

async function startRefusalProxy(blocked: string[]): Promise<{ port: number; stop(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const proxy = http.createServer((req) => {
    blocked.push(originAndPath(req.url ?? ""));
    req.socket.destroy();
  });
  proxy.on("connect", (req, socket) => {
    blocked.push(`connect ${req.url ?? ""}`);
    socket.destroy();
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    port: (proxy.address() as AddressInfo).port,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        proxy.close(() => resolve());
      }),
  };
}

export async function isolatedContext(browser: Browser, allowedOrigin: string): Promise<IsolatedContext> {
  const allowed = new URL(allowedOrigin);
  if (allowed.protocol !== "http:" || !allowed.port) {
    throw new Error(`isolatedContext needs an http origin with an explicit port, got ${allowedOrigin}`);
  }
  const blocked: string[] = [];
  const paths: string[] = [];
  const attempted: string[] = [];
  const proxy = await startRefusalProxy(blocked);
  const context = await browser.newContext({
    serviceWorkers: "block",
    proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: `<-loopback>,${allowed.host}` },
  });
  context.on("request", (request) => {
    attempted.push(request.url());
    const url = new URL(request.url());
    if (url.origin === allowed.origin) paths.push(url.pathname);
  });
  return {
    context,
    page: await context.newPage(),
    blocked,
    paths,
    attempted,
    close: async () => {
      await context.close();
      await proxy.stop();
    },
  };
}

/** The URLs in `urls` that are not on `origin`. `data:` and `blob:` URLs never
 *  reach the network, so they are not counted. */
export function offOrigin(urls: string[], origin: string): string[] {
  const allowed = new URL(origin).origin;
  return urls.filter((u) => {
    if (u.startsWith("data:") || u.startsWith("blob:")) return false;
    try {
      return new URL(u).origin !== allowed;
    } catch {
      return true;
    }
  });
}
