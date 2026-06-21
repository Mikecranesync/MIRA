import { describe, expect, it } from "vitest";
import { serverInfo, I3X_SPEC_VERSION } from "@/lib/i3x/server-info";

describe("serverInfo — MIRA is a read-only i3X server", () => {
  it("declares the i3X spec version it targets", () => {
    expect(serverInfo().specVersion).toBe(I3X_SPEC_VERSION);
    expect(serverInfo().specVersion).toBeTruthy();
  });

  it("WRITES DISABLED: update.current and update.history are both false", () => {
    const caps = serverInfo().capabilities;
    expect(caps.update.current).toBe(false);
    expect(caps.update.history).toBe(false);
  });

  it("declares history-read support (query.history = true)", () => {
    expect(serverInfo().capabilities.query.history).toBe(true);
  });

  it("declares SSE streaming unsupported in MVP (subscribe.stream = false)", () => {
    expect(serverInfo().capabilities.subscribe.stream).toBe(false);
  });

  it("identifies the server", () => {
    expect(serverInfo().serverName).toBe("MIRA");
  });

  it("always returns all four capability flags (i3X MUST)", () => {
    const caps = serverInfo().capabilities;
    expect(typeof caps.query.history).toBe("boolean");
    expect(typeof caps.update.current).toBe("boolean");
    expect(typeof caps.update.history).toBe("boolean");
    expect(typeof caps.subscribe.stream).toBe("boolean");
  });
});
