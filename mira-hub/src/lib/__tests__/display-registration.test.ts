import { describe, it, expect } from "vitest";
import { validateDisplayRegistration } from "../display-registration";

const ok = {
  unsPath: "enterprise.bench.conv_simple",
  host: "127.0.0.1",
  scheme: "http",
  port: 8890,
  path: "/data/perspective/client/ConvSimpleLive",
  displayType: "web_iframe",
  label: "Conv Simple — Live",
};

describe("validateDisplayRegistration", () => {
  it("accepts a full valid conv_simple registration", () => {
    const r = validateDisplayRegistration(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        unsPath: "enterprise.bench.conv_simple",
        host: "127.0.0.1",
        scheme: "http",
        port: 8890,
        path: "/data/perspective/client/ConvSimpleLive",
        displayType: "web_iframe",
        label: "Conv Simple — Live",
      });
    }
  });

  it("applies defaults: scheme=http, path=/, displayType=web_iframe, port=null, label=null", () => {
    const r = validateDisplayRegistration({ unsPath: "enterprise.bench.conv_simple", host: "mira-bridge" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scheme).toBe("http");
      expect(r.value.path).toBe("/");
      expect(r.value.displayType).toBe("web_iframe");
      expect(r.value.port).toBeNull();
      expect(r.value.label).toBeNull();
    }
  });

  it("requires unsPath", () => {
    expect(validateDisplayRegistration({ host: "h" })).toMatchObject({ ok: false });
  });

  it("requires host", () => {
    expect(validateDisplayRegistration({ unsPath: "enterprise.bench.conv_simple" })).toMatchObject({ ok: false });
  });

  it("rejects a malformed UNS path", () => {
    expect(validateDisplayRegistration({ unsPath: "Enterprise/Bench", host: "h" })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ unsPath: "a..b", host: "h" })).toMatchObject({ ok: false });
  });

  it("rejects a host that is actually a URL or has a path/space", () => {
    expect(validateDisplayRegistration({ ...ok, host: "http://127.0.0.1" })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ ...ok, host: "127.0.0.1/foo" })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ ...ok, host: "a b" })).toMatchObject({ ok: false });
  });

  it("rejects an out-of-range or non-integer port", () => {
    expect(validateDisplayRegistration({ ...ok, port: 0 })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ ...ok, port: 70000 })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ ...ok, port: 12.5 })).toMatchObject({ ok: false });
  });

  it("rejects an unknown scheme or display type", () => {
    expect(validateDisplayRegistration({ ...ok, scheme: "ftp" })).toMatchObject({ ok: false });
    expect(validateDisplayRegistration({ ...ok, displayType: "telnet" })).toMatchObject({ ok: false });
  });

  it("normalizes a path missing its leading slash", () => {
    const r = validateDisplayRegistration({ ...ok, path: "dashboard" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.path).toBe("/dashboard");
  });

  it("accepts a port given as a numeric string (form input)", () => {
    const r = validateDisplayRegistration({ ...ok, port: "8890" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.port).toBe(8890);
  });
});
