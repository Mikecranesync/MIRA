import { afterEach, describe, expect, it, vi } from "vitest";
import { EncryptJWT } from "jose";
import { NextRequest, type NextFetchEvent } from "next/server";
import { SHELL_LANDING, landingRedirect } from "@/capabilities/hub-landing";
import middleware from "@/middleware";

const SECRET = "test-secret-for-hub-landing-0123456789";

// Same derivation the middleware decrypts with (HKDF-SHA256, empty salt,
// next-auth's info string) — a real signed-in cookie, not a mocked decoder.
async function sessionCookie(): Promise<string> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey("raw", enc.encode(SECRET), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("NextAuth.js Generated Encryption Key") },
    ikm,
    256,
  );
  return new EncryptJWT({ sub: "u1", status: "active" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .encrypt(new Uint8Array(bits));
}

async function landOn(pathname: string, environment: string | null): Promise<string | null> {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", environment === null ? "" : `service.name=mira-hub,deployment.environment.name=${environment}`);
  const req = new NextRequest(`https://hub.test${pathname}`, {
    headers: { cookie: `next-auth.session-token=${await sessionCookie()}` },
  });
  const res = await middleware(req, {} as NextFetchEvent);
  const location = res?.headers.get("location");
  // Next keeps a request's trailing slash on a redirect ("/feed/" → "/v3/") and
  // the app's trailingSlash setting adds one to the rest; compare without it.
  return location ? new URL(location).pathname.replace(/(.)\/$/, "$1") : null;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("landingRedirect — the decision", () => {
  // Owner directive (Mike, 2026-10-14, #3880): "make them default to the new
  // interface". Production now gets the landing staging has had since 10-05, so
  // the old "production cannot flip by accident" rule is retired on purpose:
  // every environment sends the root and the classic home to the shell.
  it("sends the root and the classic home to the shell", () => {
    expect(landingRedirect("/")).toBe(SHELL_LANDING);
    expect(landingRedirect("/feed")).toBe(SHELL_LANDING);
    expect(landingRedirect("/feed/")).toBe(SHELL_LANDING);
  });

  it("never redirects anything else", () => {
    for (const p of ["/v3/", "/equipment/abc/", "/feeds", "/feed/x", "/assets/", "/onboarding/"]) {
      expect(landingRedirect(p)).toBeNull();
    }
  });
});

describe("middleware — a signed-in request lands on the shell everywhere", () => {
  it("staging: the root lands on the shell", async () => {
    expect(await landOn("/", "staging")).toBe(SHELL_LANDING);
  });

  it("staging: the classic home (where login, signup and magic links go) lands on the shell", async () => {
    expect(await landOn("/feed", "staging")).toBe(SHELL_LANDING);
    expect(await landOn("/feed/", "staging")).toBe(SHELL_LANDING);
  });

  it("production (no environment attribute): the root and the classic home land on the shell", async () => {
    expect(await landOn("/", null)).toBe(SHELL_LANDING);
    expect(await landOn("/feed", null)).toBe(SHELL_LANDING);
    expect(await landOn("/feed/", null)).toBe(SHELL_LANDING);
  });

  it("control — the shell itself is served without a redirect, on staging and production", async () => {
    expect(await landOn("/v3/", "staging")).toBeNull();
    expect(await landOn("/v3/", null)).toBeNull();
  });

  it("control — legacy pages other than the classic home stay reachable by direct URL", async () => {
    expect(await landOn("/onboarding/", null)).toBeNull();
    expect(await landOn("/assets/", null)).toBeNull();
  });
});
