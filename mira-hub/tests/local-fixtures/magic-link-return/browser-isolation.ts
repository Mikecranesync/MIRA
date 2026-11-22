/**
 * TEST ONLY. A fresh, signed-out browser context that can reach exactly one
 * origin, for the magic-link return fixture (#5753, #5798, #5831).
 *
 * A route handler is not enough: Playwright runs it once per request, and
 * Chromium follows the redirect hops of a request the handler continued (or
 * fulfilled with a 3xx) without calling it again (#5798). So the wall is the
 * browser's network stack, which applies its proxy rule to every hop: every
 * request the context makes goes to a local proxy owned by this test process.
 * Playwright turns off Chromium's implicit loopback bypass for a context
 * proxy, so loopback requests go to it too.
 *
 * The proxy forwards a request only when its target origin (scheme, host and
 * port of the request URL, not the Host header) is the allowed origin, and it
 * forwards it to a Unix socket, never to that origin's TCP port. The allowed
 * origin is only a name: whatever listens on its port, if anything, never
 * receives a browser request (#5831). Every other request is refused: the
 * destination is recorded and the connection dropped. HTTPS and other CONNECT
 * tunnels are always refused.
 *
 * The proxy lives in the Playwright process and is stopped only after the
 * context closes, so the browser can never outlive it. If the socket cannot be
 * reached while the browser is still waiting for the answer, the failure is
 * recorded in `upstreamFailures` and the browser's connection is dropped; a
 * request the browser itself abandoned is not counted.
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
  /** Every forwarded request whose upstream socket failed while the browser waited. */
  upstreamFailures: string[];
  /** Every path requested on the allowed origin, redirect hops included. */
  paths: string[];
  /** Every URL the browser asked for, recorded independently of the proxy. */
  attempted: string[];
  /** Closes the context, then the proxy. */
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

// Hop-by-hop headers belong to one connection and are not forwarded.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"]);

function forwardableRequestHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
  }
  return out;
}

function forwardableResponseHeaders(raw: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    if (!HOP_BY_HOP.has(raw[i].toLowerCase())) out.push(raw[i], raw[i + 1]);
  }
  return out;
}

async function startProxy(
  allowedOrigin: string,
  upstreamSocket: string,
  blocked: string[],
  upstreamFailures: string[],
): Promise<{ port: number; stop(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const proxy = http.createServer((req, res) => {
    let target: URL | null = null;
    try {
      target = new URL(req.url ?? "");
    } catch {
      target = null;
    }
    if (!target || target.origin !== allowedOrigin) {
      blocked.push(originAndPath(req.url ?? ""));
      req.socket.destroy();
      return;
    }
    let browserGone = false;
    res.on("close", () => {
      if (!res.writableFinished) browserGone = true;
    });
    const upstream = http.request(
      {
        socketPath: upstreamSocket,
        method: req.method,
        path: target.pathname + target.search,
        headers: forwardableRequestHeaders(req),
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, forwardableResponseHeaders(answer.rawHeaders));
        answer.pipe(res);
      },
    );
    upstream.on("error", (err: NodeJS.ErrnoException) => {
      if (!browserGone) upstreamFailures.push(`${originAndPath(req.url ?? "")} ${err.code ?? err.message}`);
      req.socket.destroy();
    });
    res.on("close", () => {
      if (browserGone) upstream.destroy();
    });
    req.pipe(upstream);
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

/** A context whose only reachable origin is `allowedOrigin`, served from the
 *  Unix socket `upstreamSocket`. */
export async function isolatedContext(
  browser: Browser,
  allowedOrigin: string,
  upstreamSocket: string,
): Promise<IsolatedContext> {
  const allowed = new URL(allowedOrigin);
  if (allowed.protocol !== "http:" || !allowed.port) {
    throw new Error(`isolatedContext needs an http origin with an explicit port, got ${allowedOrigin}`);
  }
  if (!upstreamSocket) throw new Error("isolatedContext needs the Unix socket that serves the allowed origin");
  const blocked: string[] = [];
  const upstreamFailures: string[] = [];
  const paths: string[] = [];
  const attempted: string[] = [];
  const proxy = await startProxy(allowed.origin, upstreamSocket, blocked, upstreamFailures);
  const context = await browser.newContext({
    serviceWorkers: "block",
    proxy: { server: `http://127.0.0.1:${proxy.port}` },
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
    upstreamFailures,
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
