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
  test("points at /scan, which nginx already routes to the Hub", () => {
    // NOT /m/ — that prefix is proxied to mira-web, so using it would loop.
    expect(hubScanPath("CV-101")).toBe("/scan/CV-101");
    expect(hubScanPath("CV-101").startsWith("/m/")).toBe(false);
  });

  test("encodes the tag", () => {
    expect(hubScanPath("CV 101/../admin")).toBe("/scan/CV%20101%2F..%2Fadmin");
  });
});
