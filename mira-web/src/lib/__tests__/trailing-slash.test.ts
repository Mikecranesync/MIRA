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

  it("does not redirect the root path", () => {
    const headers = new Headers({ host: "factorylm.com", "x-forwarded-proto": "https" });
    expect(trailingSlashRedirectTarget("http://127.0.0.1/", headers)).toBeNull();
  });
});
