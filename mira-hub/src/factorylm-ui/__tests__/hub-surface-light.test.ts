/**
 * The Hub's surfaces never follow the OS into dark, so its shell wrapper must opt
 * out of the shared system-dark state palette (`data-fl-surface="light"`). Without
 * it a dark-OS tablet rendered amber card text at 2.03:1 and blank sidebar labels
 * (issue 5580). The shared theme must also still define the block it opts into.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Hub shell keeps the light state palette on a dark OS", () => {
  it("tags the shell wrapper", () => {
    expect(read("../hub-host.tsx")).toMatch(/className="hub-shell-host"[^>]*data-fl-surface="light"/);
  });

  it("opts into a block the shared theme defines", () => {
    expect(read("../../../../packages/factorylm-theme/src/workspace.css")).toContain('[data-fl-surface="light"] {');
  });
});
