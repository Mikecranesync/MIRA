/**
 * Attestation that the fixture server the OTHER specs run against is the contained one (#5731 F1):
 * loopback-only, one build, no credential-like variables, and unable to reach a real backend.
 * Shared by every local fixture config (FIXTURE_PORT is set by the config). None of it uses
 * `page.route`: it talks to the real server, which is the point.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { auditFile, FIXTURE_HOST, installSessionCookie } from "./harness/fixture-harness.cjs";

const PORT = Number(process.env.FIXTURE_PORT);

type AuditEvent = { event: string; pid: number; [k: string]: unknown };
const audit = (): AuditEvent[] =>
  readFileSync(auditFile(PORT), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "one attestation per run, not per viewport"); });

test("the fixture port accepts loopback and refuses every other local address", async () => {
  expect(Number.isInteger(PORT), "FIXTURE_PORT is set by the config").toBe(true);
  expect(await canConnect(FIXTURE_HOST, PORT)).toBe(true);
  const others = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
  test.info().annotations.push({ type: "non-loopback addresses tried", description: others.join(", ") || "none on this host" });
  for (const address of others) expect(await canConnect(address, PORT), `${address}:${PORT} must refuse`).toBe(false);
});

test("one build is served on loopback and no server process holds a credential-like variable", async () => {
  const events = audit();
  const serving = events.filter((e) => e.event === "serving");
  expect(serving).toHaveLength(1);
  expect(serving[0]).toMatchObject({ host: FIXTURE_HOST, port: PORT });
  expect(String(serving[0].buildId)).toMatch(/\S+/);
  test.info().annotations.push({ type: "buildId", description: String(serving[0].buildId) });

  const loaded = events.filter((e) => e.event === "loaded");
  expect(loaded.length, "the egress guard loaded in the build/server processes").toBeGreaterThan(0);
  for (const e of loaded) expect(e.credentialLikeKeys, `pid ${e.pid}`).toEqual([]);

  // The runner's own environment may hold credentials; the point is that the server's does not.
  const runnerHolds = Object.keys(process.env).filter((k) => /(KEY|TOKEN|SECRET|PASSWORD|DATABASE|_URL$)/i.test(k) && !k.startsWith("FIXTURE_"));
  test.info().annotations.push({ type: "credential-like names in the runner env (not the server)", description: String(runnerHolds.length) });
});

test("a real un-mocked authenticated request cannot reach a backend", async ({ context, baseURL }) => {
  await installSessionCookie(context, baseURL, PORT, {
    uid: "fixture-attest", tid: "00000000-0000-4000-8000-0000000000aa", status: "trial",
    trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), email: "attest@factorylm-test.com",
  });
  const before = audit().filter((e) => e.event === "blocked").length;
  const res = await context.request.get(`${baseURL}/api/equipment-notebooks/`);
  expect(res.ok(), "the route cannot succeed without a database").toBe(false);
  const blocked = audit().filter((e) => e.event === "blocked");
  expect(blocked.length, "the server tried a backend and the guard refused it").toBeGreaterThan(before);
  test.info().annotations.push({ type: "refused", description: blocked.map((b) => `${b.kind}:${b.target}`).join(" ") });
});
