/**
 * #5265 edge profile — the runtime egress block. The startup guard
 * (edge-profile.ts) checks configuration only; destinations that arrive per
 * request or from stored data (the OpenWebUI / Telegram connect routes, the
 * Dropbox/Google external-download path, stored Google bindings and token
 * refresh, Command Center gateway probes, any redirect a loopback service
 * returns) never pass through it. This closes them at the one chokepoint they
 * share: every TCP/TLS connection the Node process opens goes through
 * `net.Socket.prototype.connect`, and every host name through `dns`. Under
 * MIRA_PROFILE=edge a connection to anything but loopback or a local socket
 * fails with EEDGEBLOCKED before a packet leaves, and the attempt is logged
 * (destination host and port only, never a payload).
 *
 * Covers undici/global fetch, http(s), tls and pg, including each redirect
 * hop (each hop opens its own socket). Does not cover child processes or
 * native addons that open sockets themselves; the Hub starts none on the edge
 * profile. Proof on the device is the network-blocked run with a kernel-level
 * monitor and a positive control, not this module.
 */
import dns from "node:dns";
import net from "node:net";

export const EDGE_EGRESS_CODE = "EEDGEBLOCKED";

const LOOPBACK_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** True for loopback addresses and names. Anything unknown is NOT loopback. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (host == null || host === "") return true; // net defaults an absent host to localhost
  const h = String(host).trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_NAMES.has(h) || h.endsWith(".localhost")) return true;
  if (net.isIPv4(h)) return h.startsWith("127.");
  if (net.isIPv6(h)) {
    if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    return mapped ? mapped[1].startsWith("127.") : false;
  }
  return false;
}

export function edgeEgressError(host: string, port: number | string | null): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(
    `MIRA_PROFILE=edge blocked an outbound connection to ${host}${port != null ? `:${port}` : ""} (this device runs offline)`,
  );
  err.code = EDGE_EGRESS_CODE;
  return err;
}

type Target = { host: string | null; port: number | string | null; path: string | null };

/** Where a `socket.connect(...)` call is going, from any of its overloads. */
function connectTarget(args: unknown[]): Target {
  let first = args[0];
  if (Array.isArray(first)) first = first[0]; // internal normalized-args form
  if (first && typeof first === "object") {
    const o = first as { host?: string; port?: number | string; path?: string };
    return { host: o.host ?? null, port: o.port ?? null, path: o.path ?? null };
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { host: typeof args[1] === "string" ? args[1] : null, port: first, path: null };
  }
  if (typeof first === "string") return { host: null, port: null, path: first }; // IPC path
  return { host: null, port: null, path: null };
}

type Installed = { uninstall: () => void; blocked: () => ReadonlyArray<{ host: string; port: number | string | null; via: string }> };

let active: Installed | null = null;

/**
 * Patch net and dns so only loopback and local sockets are reachable. Idempotent;
 * returns the active handle. `log` receives one line per blocked attempt.
 */
export function installEdgeEgressGuard(log: (line: string) => void = (l) => console.warn(l)): Installed {
  if (active) return active;
  const blocked: Array<{ host: string; port: number | string | null; via: string }> = [];
  const note = (host: string, port: number | string | null, via: string) => {
    blocked.push({ host, port, via });
    if (blocked.length > 500) blocked.shift();
    log(`[edge-egress] BLOCKED ${via} ${host}${port != null ? `:${port}` : ""}`);
  };

  const origConnect = net.Socket.prototype.connect;
  const guardedConnect = function (this: net.Socket, ...args: unknown[]) {
    const t = connectTarget(args);
    if (!t.path && !isLoopbackHost(t.host)) {
      const host = String(t.host);
      note(host, t.port, "connect");
      const err = edgeEgressError(host, t.port);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  };
  net.Socket.prototype.connect = guardedConnect as typeof net.Socket.prototype.connect;

  const restores: Array<() => void> = [];
  const wrapCallback = (obj: Record<string, unknown>, fn: string, via: string) => {
    const orig = obj[fn] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof orig !== "function") return;
    obj[fn] = function (this: unknown, host: unknown, ...rest: unknown[]) {
      if (typeof host === "string" && !isLoopbackHost(host)) {
        note(host, null, via);
        const cb = rest.reverse().find((r) => typeof r === "function") as ((e: Error) => void) | undefined;
        const err = edgeEgressError(host, null);
        if (cb) process.nextTick(() => cb(err));
        return undefined;
      }
      return orig.call(this, host, ...rest);
    };
    restores.push(() => {
      obj[fn] = orig;
    });
  };
  const wrapPromise = (obj: Record<string, unknown>, fn: string, via: string) => {
    const orig = obj[fn] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    if (typeof orig !== "function") return;
    obj[fn] = function (this: unknown, host: unknown, ...rest: unknown[]) {
      if (typeof host === "string" && !isLoopbackHost(host)) {
        note(host, null, via);
        return Promise.reject(edgeEgressError(host, null));
      }
      return orig.call(this, host, ...rest);
    };
    restores.push(() => {
      obj[fn] = orig;
    });
  };
  const DNS_FNS = ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveTxt", "resolveSrv"];
  for (const fn of DNS_FNS) {
    wrapCallback(dns as unknown as Record<string, unknown>, fn, `dns.${fn}`);
    wrapPromise(dns.promises as unknown as Record<string, unknown>, fn, `dns.promises.${fn}`);
  }

  active = {
    uninstall: () => {
      net.Socket.prototype.connect = origConnect;
      for (const r of restores) r();
      active = null;
    },
    blocked: () => blocked,
  };
  log("[edge-egress] guard installed: outbound connections limited to loopback and local sockets");
  return active;
}

/**
 * The JSON body a connect route returns on the edge profile instead of probing
 * a remote service (the socket guard would block the probe anyway; this says
 * why in the technician's words).
 */
export function edgeOfflineFeatureBody(feature: string): { error: "offline_device"; message: string } {
  return {
    error: "offline_device",
    message: `${feature} needs an internet connection. This device runs MIRA offline, so it is turned off here.`,
  };
}
