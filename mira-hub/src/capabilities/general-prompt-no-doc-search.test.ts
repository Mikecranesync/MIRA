/**
 * #4015 — general mode searched NO documentation, so its answer must never say
 * "the documentation does not specify…". Pins the directive in the notebook
 * chat route's GENERAL_SYSTEM_PROMPT (source-read, like the #3764 directive test).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const routeText = readFileSync(
  join(__dirname, "../app/api/equipment-notebooks/[id]/chat/route.ts"),
  "utf-8",
);

describe("GENERAL_SYSTEM_PROMPT never implies a documentation search (#4015)", () => {
  it("carries the no-doc-search directive inside the general prompt", () => {
    const general = routeText.match(/const GENERAL_SYSTEM_PROMPT = `([\s\S]*?)`;/);
    expect(general).toBeTruthy();
    expect(general![1]).toContain("You searched NO documentation");
    expect(general![1]).toContain("the documentation does not specify");
    expect(general![1]).toContain("I don't have this machine's manual");
  });
});
