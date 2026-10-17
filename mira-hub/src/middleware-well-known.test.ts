import { describe, expect, it } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import middleware, { config } from "./middleware";
import {
  APPLE_APP_SITE_ASSOCIATION,
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS,
  ASSETLINKS_PATH,
} from "@/capabilities/well-known-app-links";

const matcherRe = new RegExp(`^${config.matcher[0]}$`);

function unauth(path: string) {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  return middleware(req, {} as NextFetchEvent);
}

describe("middleware — App/Universal Links well-known files are public", () => {
  it("still matches the two well-known paths so the auth exemption can serve them", () => {
    // Matcher exemption alone would 404 — there is nothing in public/.well-known.
    // The 200 JSON response is the handler below, which only runs if the matcher hits.
    expect(matcherRe.test(ASSETLINKS_PATH)).toBe(true);
    expect(matcherRe.test(APPLE_APP_SITE_ASSOCIATION_PATH)).toBe(true);
  });

  it.each([ASSETLINKS_PATH, `${ASSETLINKS_PATH}/`])(
    "%s returns 200 JSON with no login redirect",
    async (path) => {
      const res = await unauth(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual(ASSET_LINKS);
    },
  );

  it.each([
    APPLE_APP_SITE_ASSOCIATION_PATH,
    `${APPLE_APP_SITE_ASSOCIATION_PATH}/`,
  ])("%s returns 200 JSON with no login redirect", async (path) => {
    const res = await unauth(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual(APPLE_APP_SITE_ASSOCIATION);
  });

  it("still 307s an unknown .well-known path to /login (auth catch-all intact)", async () => {
    const res = await unauth("/.well-known/zzz-does-not-exist");
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(new URL(loc).pathname.replace(/\/$/, "")).toBe("/login");
  });

  it("still 401s an unauthenticated API route as JSON", async () => {
    const res = await unauth("/api/chat");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
