import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * #1899 regression guard.
 *
 * The folder=brain PDF upload path (POST /api/namespace/node/[id]/files →
 * ingestPdfToNode → unpdf) 500'd on prod because, under `output: "standalone"`,
 * @vercel/nft does NOT trace unpdf's runtime `import('unpdf/pdfjs')` dynamic
 * subpath import. unpdf was dropped from `.next/standalone/node_modules`, so the
 * deployed server threw `Cannot find module 'unpdf/pdfjs'` on every PDF upload.
 *
 * The fix is `serverExternalPackages: ["unpdf"]` in next.config.ts, which keeps
 * unpdf out of the bundle and copies the full package (incl. dist/pdfjs.mjs)
 * into the standalone trace. This guard fails loudly if that line is removed —
 * the bug only manifests in a standalone *build* (dev mode resolves unpdf from
 * node_modules fine), so an e2e against `next dev` cannot catch the recurrence;
 * this static guard can.
 */
describe("#1899 unpdf standalone-bundling guard", () => {
  const nextConfig = readFileSync(
    join(__dirname, "..", "..", "..", "next.config.ts"),
    "utf8",
  );

  it("next.config still uses output: standalone (the constraint this guards)", () => {
    expect(nextConfig).toMatch(/output:\s*["']standalone["']/);
  });

  it("next.config externalizes unpdf so its runtime import('unpdf/pdfjs') resolves", () => {
    // Match an ACTIVE serverExternalPackages line (not a comment) listing unpdf.
    const active = nextConfig
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(active).toMatch(/serverExternalPackages:\s*\[[^\]]*["']unpdf["']/);
  });
});
