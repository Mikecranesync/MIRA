import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLE_APP_SITE_ASSOCIATION,
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS,
  ASSETLINKS_PATH,
  wellKnownAppLinkBody,
} from "@/capabilities/well-known-app-links";

const WELL_KNOWN_DIR = join(__dirname, "../../../../deployment/well-known");

describe("wellKnownAppLinkBody — exact public App Link paths only", () => {
  it("returns the Android Digital Asset Links document", () => {
    expect(wellKnownAppLinkBody(ASSETLINKS_PATH)).toEqual(ASSET_LINKS);
    expect(wellKnownAppLinkBody(`${ASSETLINKS_PATH}/`)).toEqual(ASSET_LINKS);
  });

  it("returns the Apple app-site-association document", () => {
    expect(wellKnownAppLinkBody(APPLE_APP_SITE_ASSOCIATION_PATH)).toEqual(
      APPLE_APP_SITE_ASSOCIATION,
    );
    expect(
      wellKnownAppLinkBody(`${APPLE_APP_SITE_ASSOCIATION_PATH}/`),
    ).toEqual(APPLE_APP_SITE_ASSOCIATION);
  });

  it("does not open neighbouring .well-known paths", () => {
    for (const p of [
      "/.well-known/zzz-does-not-exist",
      "/.well-known/acme-challenge/token",
      "/.well-known/assetlinks.json.evil",
      "/.well-known/apple-app-site-association-backup",
      "/assetlinks.json",
    ]) {
      expect(wellKnownAppLinkBody(p), p).toBeNull();
    }
  });
});

describe("Hub payloads stay identical to deployment/well-known", () => {
  it("assetlinks.json", () => {
    const onDisk = JSON.parse(
      readFileSync(join(WELL_KNOWN_DIR, "assetlinks.json"), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(ASSET_LINKS))).toEqual(onDisk);
  });

  it("apple-app-site-association", () => {
    const onDisk = JSON.parse(
      readFileSync(join(WELL_KNOWN_DIR, "apple-app-site-association"), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(APPLE_APP_SITE_ASSOCIATION))).toEqual(
      onDisk,
    );
  });
});
