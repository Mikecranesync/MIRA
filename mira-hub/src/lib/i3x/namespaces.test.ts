import { describe, expect, it } from "vitest";
import { listNamespaces } from "@/lib/i3x/namespaces";
import { MIRA_TYPE_NAMESPACE_URI } from "@/lib/i3x";

describe("listNamespaces", () => {
  it("includes the MIRA type namespace with a unique uri (i3X MUST: >=1 namespace)", () => {
    const ns = listNamespaces();
    expect(ns.length).toBeGreaterThan(0);
    const uris = ns.map((n) => n.uri);
    expect(uris).toContain(MIRA_TYPE_NAMESPACE_URI);
    expect(new Set(uris).size).toBe(uris.length); // unique
    for (const n of ns) expect(n.displayName).toBeTruthy();
  });
});
