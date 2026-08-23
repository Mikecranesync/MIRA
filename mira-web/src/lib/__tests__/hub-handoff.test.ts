/**
 * Scan hand-off decision (dogfood I5/I6 follow-up).
 *
 * Deterministic and DB-free on purpose: this is in the CI subset, so the rule
 * that decides WHICH audience a scan belongs to is guarded on every PR, not
 * only when someone runs the integration suite with a database.
 */
import { describe, test, expect } from "bun:test";
import { hubSessionPresent, hubScanPath } from "../hub-handoff.js";

describe("hubSessionPresent", () => {
  test("recognises the secure cookie used over HTTPS", () => {
    expect(hubSessionPresent({ "__Secure-next-auth.session-token": "abc" })).toBe(true);
  });

  test("recognises the plain cookie used over http (local/dev)", () => {
    expect(hubSessionPresent({ "next-auth.session-token": "abc" })).toBe(true);
  });

  test("a cold visitor keeps the funnel", () => {
    // The regression that matters: anything here that returns true for an
    // anonymous scan silently deletes the channel chooser / guest report /
    // registration path this route exists to serve.
    expect(hubSessionPresent({})).toBe(false);
    expect(hubSessionPresent({ mira_channel_pref: "telegram" })).toBe(false);
    expect(hubSessionPresent({ mira_session: "a-mira-web-token" })).toBe(false);
  });

  test("an empty cookie value is not a session", () => {
    expect(hubSessionPresent({ "next-auth.session-token": "" })).toBe(false);
  });
});

describe("hubScanPath", () => {
  test("points at /machine, the prefix nginx leaves to the Hub", () => {
    expect(hubScanPath("CV-101")).toBe("/machine/CV-101");
  });

  test("avoids every prefix another app already owns", () => {
    // /m/ is this app (would loop); /scan/ is the MIRA Scan SPA on :5180.
    // The first version of this hand-off used /scan/ and served the wrong
    // application in production, so both are pinned here, not just one.
    const path = hubScanPath("CV-101");
    expect(path.startsWith("/m/")).toBe(false);
    expect(path.startsWith("/scan/")).toBe(false);
  });

  test("encodes the tag", () => {
    expect(hubScanPath("CV 101/../admin")).toBe("/machine/CV%20101%2F..%2Fadmin");
  });
});
