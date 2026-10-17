import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { PWA_ICONS, pwaManifest } from "@/capabilities/pwa-manifest";
import { config } from "@/middleware";

// #4363 (punch list C04): a technician adds MIRA to the phone home screen from
// the browser. The browser fetches the manifest and its icons WITHOUT the
// session cookie, so the auth middleware must not bounce them to /login.

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("middleware matcher — install assets are public", () => {
  it("does not intercept the manifest, the app icons or the tab icon", () => {
    for (const p of ["/manifest.webmanifest", "/favicon.svg", ...PWA_ICONS.map((i) => i.file)]) {
      expect(matches(p), p).toBe(false);
    }
  });

  it("still guards every app page and API route", () => {
    for (const p of ["/", "/feed", "/v3", "/manifest", "/api/chat", "/apple-touch-icon", "/pwa-icon-192"]) {
      expect(matches(p), p).toBe(true);
    }
  });
});

describe("pwaManifest — installable on the deployed basePath", () => {
  it("prod (/hub): start, scope and every icon live under /hub", () => {
    const m = pwaManifest("/hub");
    expect(m.start_url).toBe("/hub/");
    expect(m.scope).toBe("/hub/");
    expect(m.display).toBe("standalone");
    for (const icon of m.icons ?? []) expect(icon.src.startsWith("/hub/")).toBe(true);
  });

  it("staging (basePath ''): served from the root", () => {
    const m = pwaManifest("");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    for (const icon of m.icons ?? []) expect(icon.src).toMatch(/^\/[a-z]/);
  });

  it("carries the 192 and 512 PNG icons Chrome requires to offer install", () => {
    const sizes = (pwaManifest("/hub").icons ?? []).filter((i) => i.type === "image/png").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("every icon it names is a real PNG of the stated size in public/", () => {
    for (const icon of PWA_ICONS) {
      const path = join(__dirname, "../../../public", icon.file);
      expect(existsSync(path), path).toBe(true);
      const buf = readFileSync(path);
      // PNG IHDR: width at byte 16, height at byte 20 (big-endian).
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
      expect(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
