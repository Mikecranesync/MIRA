// TAG-001 shadow validation (convergence Gate 8, CU-P1).
//
// Executes the REAL Hub resolver (imported straight from mira-hub — no copy)
// and the mobile resolver against the same inputs, and diffs structured
// results. The only permitted divergence is the mobile deep-link trust
// filter: an ABSOLUTE-URL input that the Hub resolves may resolve to null on
// mobile (foreign origin). Every other divergence — raw tags, /m/ paths,
// allowed-origin URLs — is a contract break and fails this suite.
//
// Inputs: the full contract corpus + 5,000 deterministic fuzz strings
// (seeded LCG, no Math.random — reproducible forever).
import { describe, it, expect } from "vitest";
import { extractAssetTag as mobileExtract, isTrustedDeepLink } from "../tags";
// eslint-disable-next-line import/no-relative-packages — the point IS to run the real Hub code
import { extractAssetTag as hubExtract } from "../../../../mira-hub/src/lib/scan-target";
import corpus from "../../../../docs/contracts/asset-tag-grammar.json";

function isAbsoluteUrl(s: string): boolean {
  return /^[a-z]+:\/\//i.test(s.trim());
}

const CANONICAL = new RegExp(corpus.canonical_regex);

// The factorylm:// scheme is the app's own surface: the OS delivers it only
// to the app, the Hub never receives it, and what Node's URL parser does
// with a non-special scheme (host='m'; a second '/m/' inside the path can
// even make the Hub resolver extract something) is a parser accident, not
// designed behavior. On this scheme, MOBILE is the contract — the shadow
// skips cross-comparison and only requires mobile's non-null results to
// satisfy the canonical grammar.
function isMobileOwnScheme(input: string): boolean {
  return input.trim().toLowerCase().startsWith("factorylm://");
}

function divergenceAllowed(input: string, hub: string | null, mobile: string | null): boolean {
  const trimmed = input.trim();
  // Sanctioned difference: mobile trust-filters absolute URLs from
  // untrusted origins down to null. Never the reverse, never on non-URL
  // forms. The trust rule is the implementation's OWN exported
  // isTrustedDeepLink — the Gate 7 review caught this test using a private
  // re-implementation (raw case-sensitive prefixes) that excused real
  // divergences on trusted-origin URLs (HTTPS://, :443). One rule, one place.
  return hub !== null && mobile === null && isAbsoluteUrl(trimmed) && !isTrustedDeepLink(trimmed);
}

// Deterministic fuzz: seeded LCG over a tag-shaped alphabet, biased toward
// the boundary characters that distinguish the two grammars.
function* fuzz(count: number): Generator<string> {
  let seed = 0x5eed_c0de;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const alpha = "abcXYZ019_-._..//m/ %2E?#:";
  // Mixed-case prefixes included deliberately: the Gate 7 review proved a
  // lowercase-only generator is blind to scheme/host-case divergences.
  const prefixes = [
    "", "/m/", "m/",
    "https://app.factorylm.com/m/", "HTTPS://APP.FACTORYLM.COM/m/", "HtTpS://app.factorylm.com/m/",
    "https://app.factorylm.com:443/m/", "https://app.factorylm.com@evil.com/m/",
    "https://evil.example.com/m/", "factorylm://m/", "FACTORYLM://m/",
  ];
  for (let i = 0; i < count; i++) {
    const len = 1 + Math.floor(next() * 70);
    let s = prefixes[Math.floor(next() * prefixes.length)];
    for (let j = 0; j < len; j++) s += alpha[Math.floor(next() * alpha.length)];
    yield s;
  }
}

describe("TAG-001 shadow: mobile vs real Hub resolver", () => {
  it("agrees on every contract-corpus case (modulo the trust filter)", () => {
    const breaks: string[] = [];
    for (const c of corpus.cases as { input: string }[]) {
      const h = hubExtract(c.input);
      const m = mobileExtract(c.input);
      if (isMobileOwnScheme(c.input)) {
        if (m !== null) expect(m).toMatch(CANONICAL);
        continue;
      }
      if (h !== m && !divergenceAllowed(c.input, h, m)) {
        breaks.push(`${JSON.stringify(c.input)}: hub=${JSON.stringify(h)} mobile=${JSON.stringify(m)}`);
      }
    }
    expect(breaks, breaks.join("\n")).toEqual([]);
  });

  it("agrees across 5,000 deterministic fuzz inputs (modulo the trust filter)", () => {
    const breaks: string[] = [];
    for (const input of fuzz(5000)) {
      if (isMobileOwnScheme(input)) {
        const mm = mobileExtract(input);
        if (mm !== null) expect(mm).toMatch(CANONICAL);
        continue;
      }
      const h = hubExtract(input);
      const m = mobileExtract(input);
      if (h !== m && !divergenceAllowed(input, h, m)) {
        breaks.push(`${JSON.stringify(input)}: hub=${JSON.stringify(h)} mobile=${JSON.stringify(m)}`);
        if (breaks.length >= 10) break; // enough evidence
      }
    }
    expect(breaks, breaks.join("\n")).toEqual([]);
  });
});
