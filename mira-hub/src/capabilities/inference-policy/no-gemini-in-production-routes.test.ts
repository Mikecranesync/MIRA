/**
 * Provider-policy guard — no Gemini reachable from a production Hub route.
 *
 * Root CLAUDE.md Hard Constraint #2: the cloud cascade is Groq → Cerebras →
 * Together. Gemini (`generativelanguage.googleapis.com` / `GEMINI_API_KEY`) is
 * a PRD §4 violation. #3688: three production routes (assets/[id]/chat,
 * namespace/node/[id]/chat, reports/generate) plus the shared classifier
 * cascade (lib/llm/cascade.ts) each hardcoded Gemini as the third provider, so
 * a real technician turn could reach it in production.
 *
 * The pre-existing provider-policy tests (canonical-cascade.test.ts,
 * equipment-notebooks/__tests__/chat-canonical-seam.test.ts) only pin the
 * canonical seam + the notebooks route. This guard EXTENDS coverage to EVERY
 * route handler under `src/app/api` and the shared cascade libs — so a NEW
 * route that hardcodes Gemini fails closed here, not only the notebooks seam.
 *
 * Run: npx vitest run src/capabilities/inference-policy/no-gemini-in-production-routes.test.ts
 * Gates the merge via the `mira-hub-unit` job (in ci-gate's needs, require_success).
 *
 * Lives under `src/capabilities/**` (the sanctioned backend seam per the UI
 * cutover guard), NOT `src/lib/**` — the cutover guard fails closed on new
 * `.ts` files in the frozen lib tree; a backend policy guard is not
 * presentation. vitest still collects it (`src/**` / *.test.ts`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file is at src/capabilities/inference-policy/<file>; three levels up = hub root.
const HUB_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// The two markers that make Gemini REACHABLE as an OpenAI-compatible provider:
// its chat-completions host, and the key an inline cascade entry reads. Either,
// in a shipped route, is the violation #3688 removed.
const GEMINI_MARKERS = [/generativelanguage\.googleapis\.com/, /GEMINI_API_KEY/];

// The ONE documented residual. The notebooks route keeps a byte-identical
// LEGACY inline cascade (with Gemini) behind the default-OFF `MIRA_CANONICAL_SEAM`
// flag, exercised only for parity by equipment-notebooks/__tests__/
// chat-canonical-seam.test.ts (which proves seam-ON never calls Gemini). Fully
// closing it = flipping the flag / deleting the legacy list, a separate migration
// tracked under #3688's follow-up. Named here so it is an EXPLICIT known residual,
// never a silent one.
const ALLOWLIST = new Set<string>([
  "src/app/api/equipment-notebooks/[id]/chat/route.ts",
]);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function mentionsGemini(source: string): boolean {
  return GEMINI_MARKERS.some((re) => re.test(source));
}

function rel(full: string): string {
  return path.relative(HUB_ROOT, full).split(path.sep).join("/");
}

// Every shipped API route handler + the shared cascade libs a route can import.
function scannedFiles(): string[] {
  const routes = walkTsFiles(path.join(HUB_ROOT, "src/app/api")).filter((f) =>
    f.endsWith("/route.ts"),
  );
  const libs = ["src/lib/llm/cascade.ts", "src/lib/inference/canonical-cascade.ts"].map((p) =>
    path.join(HUB_ROOT, p),
  );
  return [...routes, ...libs];
}

describe("provider-policy: no reachable Gemini in production Hub routes (#3688)", () => {
  it("no shipped route or shared cascade lib reaches Gemini (except the named residual)", () => {
    const offenders = scannedFiles()
      .filter((f) => !ALLOWLIST.has(rel(f)))
      .filter((f) => mentionsGemini(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the marker matcher actually catches Gemini — positive control", () => {
    // A clean result above must not come from a dead matcher.
    expect(
      mentionsGemini(`url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"`),
    ).toBe(true);
    expect(mentionsGemini(`key: process.env.GEMINI_API_KEY`)).toBe(true);
    expect(mentionsGemini(`url: "https://api.together.xyz/v1/chat/completions"`)).toBe(false);
  });

  it("the routes #3688 fixed now source the canonical (Together) cascade", () => {
    // Prove the fix is PRESENT, not merely that Gemini is absent (a deleted
    // cascade would also pass the absence check).
    for (const relPath of [
      "src/app/api/assets/[id]/chat/route.ts",
      "src/app/api/namespace/node/[id]/chat/route.ts",
      "src/app/api/reports/generate/route.ts",
    ]) {
      const src = readFileSync(path.join(HUB_ROOT, relPath), "utf8");
      expect(src, relPath).toContain("canonicalProviders");
      expect(mentionsGemini(src), relPath).toBe(false);
    }
    // The shared classifier cascade now lists Together, not Gemini.
    const cascade = readFileSync(path.join(HUB_ROOT, "src/lib/llm/cascade.ts"), "utf8");
    expect(cascade).toContain("api.together.xyz");
    expect(mentionsGemini(cascade)).toBe(false);
  });

  it("scans a non-trivial number of routes — the walk is not silently empty", () => {
    // If the glob broke and returned nothing, the offender check would vacuously
    // pass. Anchor it: the Hub has many API routes.
    const count = scannedFiles().length;
    expect(count).toBeGreaterThan(20);
  });
});
