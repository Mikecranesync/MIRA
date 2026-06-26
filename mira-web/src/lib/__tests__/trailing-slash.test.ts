import { describe, expect, it } from "bun:test";

import { trailingSlashRedirectTarget } from "../trailing-slash.js";

describe("trailingSlashRedirectTarget", () => {
  it("returns null for canonical path without trailing slash", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/pricing", headers)).toBeNull();
  });

  it("trims trailing slash and preserves forwarded https origin", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/pricing/", headers)).toBe(
      "https://factorylm.com/pricing",
    );
  });

  it("preserves query string while trimming slash", () => {
    const headers = new Headers({ "x-forwarded-host": "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://mira-web:3000/pricing/?utm=qa", headers)).toBe(
      "https://factorylm.com/pricing?utm=qa",
    );
  });

  it("strips attacker-supplied port from trusted public x-forwarded-host", () => {
    const headers = new Headers({ "x-forwarded-host": "factorylm.com:8443", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://10.10.10.10:3000/pricing/", headers)).toBe(
      "https://factorylm.com/pricing",
    );
  });

  it("strips attacker-supplied port from trusted www public x-forwarded-host", () => {
    const headers = new Headers({ "x-forwarded-host": "www.factorylm.com:444", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://10.10.10.10:3000/pricing/", headers)).toBe(
      "https://www.factorylm.com/pricing",
    );
  });

  it("does not trust hostile x-forwarded-host", () => {
    const headers = new Headers({
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      host: "mira-web:3000",
    });
    expect(trailingSlashRedirectTarget("http://10.10.10.10:3000/pricing/", headers)).toBe(
      "https://factorylm.com/pricing",
    );
  });

  it("does not trust loopback x-forwarded-host values", () => {
    const headers = new Headers({
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "https",
      host: "factorylm.com",
    });
    expect(trailingSlashRedirectTarget("http://10.10.10.10:3000/pricing/", headers)).toBe(
      "https://factorylm.com/pricing",
    );
  });

  it("falls back to the public host when x-forwarded-host and host are untrusted", () => {
    const headers = new Headers({
      "x-forwarded-host": "127.0.0.1:3200",
      "x-forwarded-proto": "https",
      host: "mira-web:3000",
    });
    expect(trailingSlashRedirectTarget("http://10.10.10.10:3000/pricing/", headers)).toBe(
      "https://factorylm.com/pricing",
    );
  });

  it("ignores invalid x-forwarded-proto", () => {
    const headers = new Headers({
      "x-forwarded-host": "factorylm.com",
      "x-forwarded-proto": "ftp",
    });
    expect(trailingSlashRedirectTarget("http://127.0.0.1:3000/pricing/", headers)).toBe(
      "http://factorylm.com/pricing",
    );
  });

  it("does not redirect the root path", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/", headers)).toBeNull();
  });
});
