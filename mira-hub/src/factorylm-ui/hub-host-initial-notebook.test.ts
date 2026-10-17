/**
 * D4 — the classic equipment page routes through the shared shell. The host
 * takes the notebook its route names and ranks it: explicit `?notebook=` deep
 * link first, then the route's notebook, then HOME. Pinned by reading the
 * source, the way `hub-host-initial-state.test.ts` pins the drawer rule: this
 * suite does not install the shell's React tree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("HubShellHost initialNotebookId (D4)", () => {
  const host = read("./hub-host.tsx");

  it("accepts the route's notebook as a prop", () => {
    expect(host).toMatch(/export function HubShellHost\(\{ initialNotebookId \}: \{ initialNotebookId\?: string \} = \{\}\)/);
  });

  it("ranks it below the ?notebook= deep link and above the HOME landing, on the first selection only", () => {
    const first = host.indexOf("selectionFromSearch(readSearch(), data.notebooks)");
    const prop = host.indexOf("selectionForNotebook(initialNotebookId, data.notebooks)");
    const home = host.indexOf("landingSelection(data.notebooks)");
    expect(first).toBeGreaterThan(-1);
    expect(prop).toBeGreaterThan(first);
    expect(home).toBeGreaterThan(prop);
    // All three inside the one `if (!selectionRef.current)` block: the prop never re-selects after a send.
    const gate = host.lastIndexOf("if (!selectionRef.current) {", first);
    expect(gate).toBeGreaterThan(-1);
    expect(host.slice(gate, home)).not.toMatch(/\n  \}, \[/);
  });

  it("control: /v3 still mounts the host bare (HOME landing unchanged)", () => {
    expect(read("../app/v3/page.tsx")).toMatch(/<HubShellHost \/>/);
  });
});
