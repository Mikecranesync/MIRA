// The build-time contract between vite.config.ts and live-update.ts.
//
// These two files have to agree on ONE identifier, and nothing at runtime tells
// you when they stop agreeing — the fallback just quietly returns "unset", the
// shell then refuses every correctly-stamped bundle, and OTA is dead with no
// error anywhere. That is exactly what shipped in 1.0.1(2): the installed APK
// reported `Native fingerprint: unset`, and a clean `vite build` on main
// reproduced it.
//
// The cause is subtle enough to be worth pinning: Vite's `define` substitutes a
// bare IDENTIFIER. It does not rewrite `globalThis.__FLM_NATIVE_FINGERPRINT__`,
// because that is a property access, not an identifier. So the two never met.
//
// A unit test cannot observe the substitution (vitest does not apply the app's
// define), so this asserts the source-level shape that makes it possible.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const liveUpdateRaw = readFileSync(resolve(root, "src/lib/live-update.ts"), "utf8");
// Assert on the exact EXPRESSIONS rather than stripping comments: the comments
// in that file name the broken form on purpose, and any stripper sophisticated
// enough to ignore them is a thing that can itself be wrong (the first attempt
// here was, on CRLF input).
const liveUpdate = liveUpdateRaw;
/** The form that shipped "unset" to production. */
const BROKEN_FORM = '(globalThis as any).__FLM_NATIVE_FINGERPRINT__';
const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");

const TOKEN = "__FLM_NATIVE_FINGERPRINT__";

describe("native fingerprint build wiring", () => {
  it("vite.config defines the token", () => {
    expect(viteConfig).toContain(`${TOKEN}:`);
    expect(viteConfig).toContain("nativeFingerprint()");
  });

  it("live-update reads the BARE identifier, so define can replace it", () => {
    expect(liveUpdate).toContain(`typeof ${TOKEN} !== "undefined"`);
  });

  it("live-update does NOT read it off globalThis — define cannot rewrite that", () => {
    expect(liveUpdate).not.toContain(BROKEN_FORM);
  });

  it("guards with typeof so a build without the define cannot throw", () => {
    // Referencing an undeclared identifier directly is a ReferenceError; only
    // `typeof` is safe. vitest and `vite dev` both hit this path.
    const idx = liveUpdate.indexOf(`typeof ${TOKEN}`);
    expect(idx).toBeGreaterThan(-1);
    expect(liveUpdate.slice(idx, idx + 200)).toContain('"unset"');
  });

  it("declares the token so TypeScript accepts the bare reference", () => {
    expect(liveUpdate).toMatch(new RegExp(`declare const ${TOKEN}\\s*:`));
  });
});
