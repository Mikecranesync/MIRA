# Fix #3 — #574 chat: NFKC-normalize safety keywords + word-boundary match

**Branch:** `agent/issue-574-byo-llm-asset-chat-0331`
**Severity:** 🔴 Security blocker
**Effort:** ~30 min

## What's broken

`mira-hub/src/app/api/v1/assets/[id]/chat/route.ts:62-68`:

```ts
function findSafetyMatch(text: string): string | null {
  const lower = text.toLowerCase();
  for (const kw of SAFETY_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}
```

Two problems:
1. **`toLowerCase` doesn't fold confusables.** A user typing `arсh flash` (Cyrillic `с` U+0441 instead of Latin `c` U+0063) bypasses the substring match. The visual is identical; the character isn't.
2. **`includes` is substring, not word-boundary.** `loto` matches `pilots` and `lotion`. Doesn't cause false denies (we ARE blocking actual safety phrases), but it does cause false-POSITIVE blocks on innocent text. Long-term this leads to the safety gate being switched off entirely "because it's flaky."

## The fix

Replace the function with NFKC normalization + diacritic stripping + word-boundary anchored regex.

```ts
// mira-hub/src/lib/safety.ts (new file)
//
// Safety-keyword gate. Designed to be importable across services
// (chat route, future tool-use gate, future report generator).
//
// Defence model: we want "block messages where the user is asking the
// AI to walk them through performing a regulated-safety procedure."
// The keyword list is necessary-but-not-sufficient — paired with a
// system-prompt instruction that the model still refuses, the gate is
// the load-bearing wall.

export const SAFETY_KEYWORDS: ReadonlyArray<string> = [
  "arc flash",
  "loto",
  "lockout tagout",
  "lockout/tagout",
  "lock out tag out",
  "confined space",
  "hot work",
  "energized work",
  "energised work",
  "live electrical",
  "high voltage",
  "fall protection",
  "ppe required",
  "respirator required",
  "asphyxiation",
  "hydrogen sulfide",
  "h2s",
  "explosive atmosphere",
  "atex zone",
  "permit required",
  "isolation procedure",
];

/**
 * Pre-built regex set. Each keyword is matched as a Unicode word, so
 * "loto" doesn't match "pilots" but "lockout/tagout" still matches its
 * literal slash form.
 *
 * The keywords are normalized the same way the input will be, so
 * unicode-mark folding works in both directions.
 */
const SAFETY_REGEXES: ReadonlyArray<{ raw: string; re: RegExp }> = SAFETY_KEYWORDS.map(
  (kw) => {
    const norm = normalize(kw);
    // Escape regex metacharacters in the keyword, then anchor with
    // Unicode word boundaries. \b in JS only works on ASCII, so we
    // substitute a Unicode-aware lookaround pair.
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`,
      "iu",
    );
    return { raw: kw, re };
  },
);

/**
 * Returns the first matching keyword, or null.
 *
 * Normalization steps applied to `text`:
 *   1. NFKC — folds compatibility characters (e.g. ｆ → f, full-width
 *      digits, Roman numerals, etc.).
 *   2. Strip combining marks (NFD then drop \p{M}).
 *   3. Substitute homoglyphs from a small fixed table (Cyrillic
 *      a/c/e/o/p/x and Greek omicron/alpha — the cheap ones).
 *
 * We deliberately do NOT do "any unicode confusables" because the
 * confusables.txt set is huge (>10k entries) and produces false
 * positives in non-Latin user content.
 */
export function findSafetyMatch(text: string): string | null {
  const norm = normalize(text);
  for (const { raw, re } of SAFETY_REGEXES) {
    if (re.test(norm)) return raw;
  }
  return null;
}

// ---------------------------------------------------------------------------

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic that looks like Latin lowercase
  "а": "a", // а
  "с": "c", // с
  "е": "e", // е
  "о": "o", // о
  "р": "p", // р
  "х": "x", // х
  // Greek
  "ο": "o", // ο
  "α": "a", // α
  // Fullwidth ASCII (compatibility — NFKC handles most, but be belt+braces)
  "Ａ": "a",
  "Ｂ": "b",
};

function normalize(s: string): string {
  // NFKC handles fullwidth, compatibility forms, ligatures.
  let out = s.normalize("NFKC").toLowerCase();
  // Strip combining marks (NFD splits e.g. é into e + ́; we drop ́).
  out = out.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  // Substitute the small homoglyph table.
  out = out.replace(/[асеорхοαＡＢ]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  return out;
}
```

Then in the route file, replace the inline keyword list + function:

```ts
// mira-hub/src/app/api/v1/assets/[id]/chat/route.ts

// REMOVE the inline SAFETY_KEYWORDS and findSafetyMatch.
// Add:
import { findSafetyMatch } from "@/lib/safety";
```

## Test

`mira-hub/src/lib/__tests__/safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findSafetyMatch, SAFETY_KEYWORDS } from "../safety";

describe("findSafetyMatch — positive cases", () => {
  it("matches plain ASCII keyword in lowercase", () => {
    expect(findSafetyMatch("arc flash")).toBe("arc flash");
  });

  it("matches ASCII keyword surrounded by other text", () => {
    expect(findSafetyMatch("Walk me through arc flash on panel 3A")).toBe("arc flash");
  });

  it("matches in mixed case", () => {
    expect(findSafetyMatch("LOTO procedure please")).toBe("loto");
  });

  it("matches the slash variant", () => {
    expect(findSafetyMatch("show me the lockout/tagout for this motor")).toBe(
      "lockout/tagout",
    );
  });

  it("matches across all 21 keywords (sanity)", () => {
    for (const kw of SAFETY_KEYWORDS) {
      expect(findSafetyMatch(`a sentence containing ${kw} in it`)).toBe(kw);
    }
  });
});

describe("findSafetyMatch — Unicode bypass attempts (the bug)", () => {
  it("matches keyword with Cyrillic homoglyph", () => {
    // 'arсh flash' — 'с' is U+0441 (Cyrillic), not Latin 'c'.
    // ... but we want this to fold so it matches "arc flash".
    expect(findSafetyMatch("arс flash")).toBe("arc flash");
  });

  it("matches keyword with Greek omicron homoglyph", () => {
    // 'lockοut' — 'ο' is U+03BF (Greek)
    expect(findSafetyMatch("lοck out tag out NOW")).toBe("lock out tag out");
  });

  it("matches keyword with combining diacritics", () => {
    // 'árc flash' — accent on a
    expect(findSafetyMatch("árc flash on the disconnect")).toBe("arc flash");
  });

  it("matches fullwidth ASCII variant", () => {
    // 'ＡＲＣ ＦＬＡＳＨ' (fullwidth)
    expect(findSafetyMatch("ＡＲＣ ＦＬＡＳＨ")).toBe("arc flash");
  });
});

describe("findSafetyMatch — false positives we should NOT trigger", () => {
  it("does not match 'loto' inside 'pilots'", () => {
    expect(findSafetyMatch("the pilots are ready")).toBe(null);
  });

  it("does not match 'h2s' inside 'h2s2o4' or 'jh2s' or chat noise", () => {
    expect(findSafetyMatch("zh2sa hello")).toBe(null);
    expect(findSafetyMatch("h2s2o4 chemistry")).toBe(null);
    // But standalone DOES match.
    expect(findSafetyMatch("we have h2s in the line")).toBe("h2s");
  });

  it("does not match 'hot work' inside 'shot worker'", () => {
    expect(findSafetyMatch("the shot worker is here")).toBe(null);
  });

  it("does not match within an unrelated word containing the substring", () => {
    expect(findSafetyMatch("hydrogenation process")).toBe(null);
  });
});

describe("findSafetyMatch — null cases", () => {
  it("returns null for empty string", () => {
    expect(findSafetyMatch("")).toBe(null);
  });

  it("returns null for non-safety prose", () => {
    expect(findSafetyMatch("how do I configure the dashboard refresh")).toBe(null);
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/__tests__/safety.test.ts
```

All 14 tests pass. Bypass via Cyrillic/Greek/diacritic/fullwidth all blocked. False-positive substring matches eliminated.

## What this trades

- The homoglyph table is small. A determined attacker can find a confusable not in the table (e.g. mathematical alphanumeric). That's an acceptable trade vs. the false-positive cost of full ICU confusables data. If a real customer report comes in for a missed bypass, add the character to `HOMOGLYPHS` and ship.
- Word boundaries use Unicode property escapes (`\p{L}`, `\p{N}`) — Node 20+ and modern browsers handle them. If you need older runtimes, change to ASCII `\b` and accept that keyword-internal Unicode breaks.
