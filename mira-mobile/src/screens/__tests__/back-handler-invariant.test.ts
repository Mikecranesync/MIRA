import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The invariant More.tsx states in prose, made executable:
 *
 *   "Android back pops the pushed views before leaving the tab. This is assigned
 *    BEFORE any early return: a pushed view that renders without registering its
 *    back handler is unpoppable, and hardware back then falls through to
 *    minimizeApp — the technician taps back and the whole app disappears."
 *
 * A screen that returns its pushed view BEFORE assigning `backRef.current` leaves
 * the previous screen's handler installed, or none at all. App.tsx ends its chain
 * with `if (!consumed) void CapApp.minimizeApp()`, so the failure mode is not a
 * clumsy transition — it is the app vanishing from a non-root screen. That is
 * exactly what happened with About & Updates on the unified root.
 *
 * Prose in one file cannot protect the other six. This can.
 */

const SCREENS = new URL("../", import.meta.url);

/**
 * Component-level early returns only. A `return` inside a module-level helper, a
 * `useEffect` cleanup, or a callback is not an early exit from the component, and
 * counting those produced three false positives when this was first written by
 * hand — a module helper, another helper, and an effect cleanup.
 *
 * Scope: from the enclosing top-level `function` declaration down to the
 * assignment, counting only returns at the component's own indentation (2 spaces).
 * Deeper indentation is nested; anything above the declaration is another symbol.
 */
export function earlyReturnBeforeBackRef(source: string): number | null {
  const lines = source.split("\n");
  const assignAt = lines.findIndex((l) => /\bbackRef\.current\s*=/.test(l));
  if (assignAt === -1) return null; // screen does not claim Back at all

  let declAt = 0;
  for (let i = assignAt; i >= 0; i--) {
    if (/^(export\s+)?(default\s+)?function\s/.test(lines[i])) {
      declAt = i;
      break;
    }
  }

  for (let i = declAt + 1; i < assignAt; i++) {
    if (/^ {2}(if\s*\([^)]*\)\s*)?return[\s(;]/.test(lines[i])) return i + 1;
  }
  return null;
}

describe("hardware Back can always pop a pushed view", () => {
  const files = readdirSync(SCREENS).filter((f) => f.endsWith(".tsx") && !f.startsWith("."));

  it("finds screens to check (a guard over an empty set proves nothing)", () => {
    const claimants = files.filter((f) =>
      /\bbackRef\.current\s*=/.test(readFileSync(new URL(f, SCREENS), "utf8")),
    );
    expect(claimants.length).toBeGreaterThanOrEqual(5);
  });

  it.each(
    files.filter((f) => /\bbackRef\.current\s*=/.test(readFileSync(new URL(f, SCREENS), "utf8"))),
  )("%s assigns backRef.current before any early return", (file) => {
    const line = earlyReturnBeforeBackRef(readFileSync(new URL(file, SCREENS), "utf8"));
    expect(
      line,
      `${file}:${line} returns before backRef.current is assigned. A pushed view rendered ` +
        `from there is unpoppable, and hardware Back falls through to minimizeApp.`,
    ).toBeNull();
  });

  // Positive control. Without it, a checker that silently matched nothing would
  // report every screen clean — the vacuous-guard failure this suite exists to
  // prevent elsewhere.
  it("positive control: the checker detects a real violation", () => {
    const bad = [
      "export function Broken({ backRef }: Props) {",
      "  if (loading) return <Spinner />;",
      "  backRef.current = () => false;",
      "  return <div />;",
      "}",
    ].join("\n");
    expect(earlyReturnBeforeBackRef(bad)).toBe(2);
  });

  it("negative control: nested returns are not miscounted as early exits", () => {
    const fine = [
      "export function helper() {",
      "  return 1;", // module-level helper, above the component
      "}",
      "export function Fine({ backRef }: Props) {",
      "  useEffect(() => {",
      "    return () => undefined;", // effect cleanup, deeper indent
      "  }, []);",
      "  backRef.current = () => false;",
      "  return <div />;",
      "}",
    ].join("\n");
    expect(earlyReturnBeforeBackRef(fine)).toBeNull();
  });
});
