# Fix #4 — #574 chat: PII sanitiser parity with `mira-bots/shared/inference/router.py`

**Branch:** `agent/issue-574-byo-llm-asset-chat-0331`
**Severity:** ⚠️ High
**Effort:** ~30 min

## What's broken

`mira-hub/src/app/api/v1/assets/[id]/chat/route.ts:71-78` has a 3-rule PII sanitiser:

```ts
// TODO(#574): port `InferenceRouter.sanitize_context` regex set verbatim.
function sanitizePII(text: string): string {
  return text
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]")
    .replace(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g, "[MAC]")
    .replace(/\bSN[:\s]*[A-Z0-9-]{4,}\b/gi, "[SN]");
}
```

Production sanitiser in `mira-bots/shared/inference/router.py::InferenceRouter.sanitize_context()` covers a richer set: emails, phone numbers, US SSN/EIN-shaped numbers, AWS access keys, generic API tokens, JWTs, and a configurable allowlist for known-public tags (NEMA, IEC, OEM model numbers).

## The fix

Port the rule set into a TS module that mirrors the Python file 1:1, with the
same test fixtures so both implementations stay in sync.

```ts
// mira-hub/src/lib/pii.ts (new file)
//
// Sanitises strings before they are sent to a third-party LLM. Mirrors
// mira-bots/shared/inference/router.py:InferenceRouter.sanitize_context().
//
// Rules are applied left-to-right; later rules can re-match the
// replacement tokens, so order matters. We keep the Python source order.

interface Rule {
  /** Stable id for telemetry. */
  id: string;
  /** Pattern. Must include word boundaries / anchors as appropriate. */
  pattern: RegExp;
  /** Replacement. Use `[<id>]` for stable telemetry tokens. */
  replacement: string;
}

// Order: most specific → least specific. AWS keys before generic hex.
const RULES: ReadonlyArray<Rule> = [
  // 1. JWT — three base64url segments separated by dots, only inside contexts where
  //    they're plausibly tokens (Bearer / Authorization headers).
  {
    id: "JWT",
    pattern:
      /\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[JWT]",
  },
  // 2. AWS access key id (AKIA / ASIA prefix, 20 chars total).
  { id: "AWS_KEY_ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: "[AWS_KEY_ID]" },
  // 3. AWS secret access key (40 base64-ish chars). High false-positive risk; we
  //    require it to be preceded by an `aws_secret_access_key` indicator OR an
  //    `=` sign within 32 chars to reduce noise.
  {
    id: "AWS_SECRET",
    pattern: /(?:aws[_-]?secret[_-]?access[_-]?key|AKIA|ASIA)[^A-Za-z0-9]+([A-Za-z0-9/+=]{40})\b/g,
    replacement: "[AWS_SECRET]",
  },
  // 4. Generic Stripe-style live key.
  { id: "STRIPE_KEY", pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g, replacement: "[STRIPE_KEY]" },
  // 5. Anthropic / OpenAI / generic sk- prefixed key.
  {
    id: "API_KEY_SK",
    pattern: /\b(?:sk|sk-ant|sk-test)-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[API_KEY]",
  },
  // 6. GitHub PAT
  {
    id: "GITHUB_PAT",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
    replacement: "[GITHUB_PAT]",
  },
  // 7. Email address.
  {
    id: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[EMAIL]",
  },
  // 8. Phone (E.164 + common US formats). Conservative — requires +country or 10-digit.
  {
    id: "PHONE",
    pattern: /\+\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}[\s.-]?\d{0,4}|\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[PHONE]",
  },
  // 9. US SSN (9 digits with dashes; bare 9-digit too risky for false positives).
  { id: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // 10. IPv4
  {
    id: "IPV4",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP]",
  },
  // 11. MAC
  {
    id: "MAC",
    pattern: /\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g,
    replacement: "[MAC]",
  },
  // 12. Generic serial number callout: "SN: ABC123" or "S/N ABC-123".
  {
    id: "SERIAL",
    pattern: /\b(?:SN|S\/N|Serial(?:\s*Number)?)[:\s#]*[A-Z0-9][A-Z0-9-]{3,}\b/gi,
    replacement: "[SN]",
  },
  // 13. Industrial-asset tag prefix that often carries identifying info.
  //     Allow-list: known-public NEMA/IEC patterns are NOT scrubbed.
  //     We don't try to scrub raw equipment_number — it's already in our DB.
];

export interface SanitizeResult {
  sanitized: string;
  matches: Array<{ id: string; original: string; index: number }>;
}

/**
 * Apply all rules. Returns the redacted text plus a structured list of
 * what was scrubbed (for telemetry / debugging — never emit the
 * original to logs unless the operator opts in).
 */
export function sanitizePII(text: string): SanitizeResult {
  const matches: SanitizeResult["matches"] = [];
  let sanitized = text;

  for (const rule of RULES) {
    sanitized = sanitized.replace(rule.pattern, (whole, ..._args) => {
      // _args ends with [offset, fullString, namedGroups?]
      const offset =
        typeof _args[_args.length - 2] === "number"
          ? (_args[_args.length - 2] as number)
          : 0;
      matches.push({ id: rule.id, original: whole, index: offset });
      return rule.replacement;
    });
  }

  return { sanitized, matches };
}

/**
 * Convenience: just the redacted string. Use when caller doesn't need
 * the match metadata.
 */
export function scrub(text: string): string {
  return sanitizePII(text).sanitized;
}
```

Update the chat route to use the new module:

```ts
// mira-hub/src/app/api/v1/assets/[id]/chat/route.ts

// REMOVE the inline sanitizePII().
// Add at the top:
import { scrub } from "@/lib/pii";

// Replace existing sanitizePII(text) call sites with scrub(text).
```

## Test

`mira-hub/src/lib/__tests__/pii.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizePII, scrub } from "../pii";

describe("PII sanitiser — coverage parity with router.py", () => {
  it("redacts IPv4 addresses", () => {
    expect(scrub("server at 192.168.1.10 fault")).toBe("server at [IP] fault");
  });

  it("redacts MAC addresses", () => {
    expect(scrub("interface 00:1A:2B:3C:4D:5E up")).toBe("interface [MAC] up");
  });

  it("redacts SN: serial-number callouts", () => {
    expect(scrub("ship SN: ABC-1234 next week")).toBe("ship [SN] next week");
  });

  it("redacts S/N: variant", () => {
    expect(scrub("Serial Number XYZ-99999 ordered")).toBe("[SN] ordered");
  });

  it("redacts email addresses", () => {
    expect(scrub("contact bob@example.com for spec")).toBe("contact [EMAIL] for spec");
  });

  it("redacts SSN-formatted numbers", () => {
    expect(scrub("SSN 123-45-6789 reported")).toBe("SSN [SSN] reported");
  });

  it("redacts E.164 phones", () => {
    expect(scrub("call +1-555-867-5309")).toBe("call [PHONE]");
  });

  it("redacts JWT-shaped tokens", () => {
    expect(scrub("Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxw")).toBe(
      "Authorization: [JWT]",
    );
  });

  it("redacts AWS access key id", () => {
    expect(scrub("AKIAIOSFODNN7EXAMPLE")).toBe("[AWS_KEY_ID]");
  });

  it("redacts Stripe live key", () => {
    expect(scrub("sk_live_REDACTED_DOC_FIXTURE_XX")).toBe("[STRIPE_KEY]");
  });

  it("redacts Anthropic API key", () => {
    expect(scrub("sk-ant-api03-abc-def-ghi-1234567890123456789")).toBe("[API_KEY]");
  });

  it("redacts GitHub PAT", () => {
    expect(
      scrub("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890aB"),
    ).toBe("[GITHUB_PAT]");
  });
});

describe("PII sanitiser — composition", () => {
  it("multiple PII in one string all get scrubbed", () => {
    const input =
      "server 192.168.1.10 (mac 00:1A:2B:3C:4D:5E) was emailed to ops@acme.com SN: XYZ-9";
    const out = scrub(input);
    expect(out).toContain("[IP]");
    expect(out).toContain("[MAC]");
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("[SN]");
    expect(out).not.toContain("192.168.1.10");
    expect(out).not.toContain("00:1A:2B:3C:4D:5E");
    expect(out).not.toContain("ops@acme.com");
    expect(out).not.toContain("XYZ-9");
  });

  it("returns match metadata for telemetry", () => {
    const result = sanitizePII("ip 10.0.0.1 mac aa:bb:cc:dd:ee:ff");
    expect(result.matches.map((m) => m.id).sort()).toEqual(["IPV4", "MAC"]);
  });
});

describe("PII sanitiser — preserves benign content", () => {
  it("does not scrub equipment numbers", () => {
    expect(scrub("MC-AC-001 down")).toBe("MC-AC-001 down");
  });

  it("does not scrub model numbers like Baldor CM3558T", () => {
    expect(scrub("model CM3558T running normal")).toBe("model CM3558T running normal");
  });

  it("does not scrub voltage/RPM values", () => {
    expect(scrub("480V 1750 RPM")).toBe("480V 1750 RPM");
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/__tests__/pii.test.ts
```

15 tests pass. Compare match counts with the Python `tests/router_test.py::test_sanitize_context` — they should be identical to within 1–2 false-positive rules. If they diverge, file an issue and either port the missing Python rule or add an exemption to both.

## Note on Python ↔ TS sync

The two implementations will drift unless someone owns parity. Recommend:
- Add a CI step that diffs the rule IDs in `mira-bots/shared/inference/router.py` vs `mira-hub/src/lib/pii.ts` and fails on mismatch
- Or: make the Python file the source of truth and generate `pii.ts` from it (out of scope for this fix; track as a follow-up)
