import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Sellable Ask path lock: mira-mobile → Hub equipment-notebook chat →
 * manual-rag → citation SSE. A scan lands in that notebook (scan-landing.ts);
 * the composer then posts here. These fragments are the retired doors.
 */
const FORBIDDEN = [
  "/api/hub/ask",
  "ask_api",
  "t.me/",
  "openwebui",
  "mira-pipeline",
  "/v1/chat/completions",
];

describe("mira-mobile Ask MIRA uses Hub equipment-notebook chat", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const resources = readFileSync(resolve(here, "../resources.ts"), "utf8");
  const scanLanding = readFileSync(resolve(here, "../../lib/scan-landing.ts"), "utf8");
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("askNotebook posts only to /api/equipment-notebooks/:id/chat/", () => {
    const body = code(resources);
    expect(body).toMatch(
      /`\/api\/equipment-notebooks\/\$\{encodeURIComponent\(notebookId\)\}\/chat\/`/,
    );
    for (const fragment of FORBIDDEN) {
      expect(body).not.toContain(fragment);
    }
  });

  it("a resolved scan opens that machine's notebook, not a side door", () => {
    const body = code(scanLanding);
    expect(body).toContain('kind: "notebook"');
    expect(body).toContain("openAssetNotebook");
    for (const fragment of FORBIDDEN) {
      expect(body).not.toContain(fragment);
    }
  });
});
