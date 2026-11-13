import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldForDetection } from "../detection-fold";

/**
 * #5485 / #3980: `detection-fold.ts` is a shareable copy of the private fold in
 * `answer-validation.ts` (that file is held by open PRs #4929/#4931). These
 * tests fail the moment the two copies disagree, so the copy can never become
 * a second fold with different rules.
 */
const DIR = join(__dirname, "..");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

/** The value of `const NAME = <value>;` (exported or not), or null. */
function constValue(src: string, name: string): string | null {
  const m = src.match(new RegExp(`^(?:export )?const ${name} = (.+);$`, "m"));
  return m ? m[1] : null;
}

/** The body of `function foldForDetection(...) { ... }` up to its closing brace at column 0. */
function foldBody(src: string): string | null {
  const m = src.match(/^(?:export )?function foldForDetection\(s: string\): string \{\n([\s\S]*?)\n\}$/m);
  return m ? m[1] : null;
}

describe("the shared fold is the same fold as answer-validation's", () => {
  const original = read("answer-validation.ts");
  const copy = read("detection-fold.ts");

  it.each(["HYPHEN_EQUIV_CHARS", "HYPHEN_EQUIV", "APOSTROPHE_EQUIV_CHARS", "APOSTROPHE_EQUIV", "UNICODE_SPACE_CHARS", "UNICODE_SPACE", "ZERO_WIDTH"])(
    "%s is identical in both files",
    (name) => {
      const a = constValue(original, name);
      expect(a, `${name} not found in answer-validation.ts`).not.toBeNull();
      expect(constValue(copy, name)).toBe(a);
    },
  );

  it("the fold body is identical in both files", () => {
    const a = foldBody(original);
    expect(a, "foldForDetection not found in answer-validation.ts").not.toBeNull();
    expect(foldBody(copy)).toBe(a);
  });
});

describe("foldForDetection (shared copy)", () => {
  it("folds hyphen equivalents, apostrophes, Unicode spaces and invisibles", () => {
    expect(foldForDetection("GS11N‑20P2")).toBe("GS11N-20P2");
    expect(foldForDetection("let’s")).toBe("let's");
    expect(foldForDetection("back to mine")).toBe("back to mine");
    expect(foldForDetection("mi​ne­")).toBe("mine");
  });

  it("leaves en dash, em dash and the ellipsis character alone (each grammar owns those, #3980)", () => {
    expect(foldForDetection("0–600 A — ok…")).toBe("0–600 A — ok…");
  });
});
