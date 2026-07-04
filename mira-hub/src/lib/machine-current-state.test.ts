/**
 * Pure-logic tests for the Machine Memory current-state derivation — all seven
 * branches of deriveCurrentState (window open/closed/absent × signal freshness).
 */
import { expect, test, describe } from "vitest";
import { deriveCurrentState, type WindowRow } from "./machine-current-state";

const openWindow: WindowRow = {
  state: "faulted",
  started_at: "2026-07-04T10:02:02Z",
  ended_at: null,
};

const closedWindow: WindowRow = {
  state: "running",
  started_at: "2026-07-04T09:00:00Z",
  ended_at: "2026-07-04T09:30:00Z",
};

describe("deriveCurrentState", () => {
  test("1. open window → its state, since=started_at, fresh mirrors liveness", () => {
    expect(deriveCurrentState(openWindow, "live")).toEqual({
      state: "faulted",
      since: openWindow.started_at,
      fresh: true,
    });
    expect(deriveCurrentState(openWindow, "stale")).toEqual({
      state: "faulted",
      since: openWindow.started_at,
      fresh: false,
    });
  });

  test("2. closed window + live signals → window state still trusted", () => {
    expect(deriveCurrentState(closedWindow, "live")).toEqual({
      state: "running",
      since: closedWindow.ended_at,
      fresh: true,
    });
  });

  test("3. closed window + stale signals → comm_down downgrade", () => {
    expect(deriveCurrentState(closedWindow, "stale")).toEqual({
      state: "comm_down",
      since: null,
      fresh: false,
    });
  });

  test("4. closed window + simulated/unknown signals → unknown", () => {
    expect(deriveCurrentState(closedWindow, "simulated")).toEqual({
      state: "unknown",
      since: null,
      fresh: false,
    });
    expect(deriveCurrentState(closedWindow, "unknown")).toEqual({
      state: "unknown",
      since: null,
      fresh: false,
    });
  });

  test("5. no window + live signals → unknown but fresh", () => {
    expect(deriveCurrentState(null, "live")).toEqual({
      state: "unknown",
      since: null,
      fresh: true,
    });
  });

  test("6. no window + stale signals → comm_down", () => {
    expect(deriveCurrentState(null, "stale")).toEqual({
      state: "comm_down",
      since: null,
      fresh: false,
    });
  });

  test("7. no window + no signals → null (card falls back to empty state)", () => {
    expect(deriveCurrentState(null, "unknown")).toBeNull();
    expect(deriveCurrentState(null, "simulated")).toBeNull();
  });
});
