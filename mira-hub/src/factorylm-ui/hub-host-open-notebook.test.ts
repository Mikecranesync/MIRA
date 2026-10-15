/**
 * #4444: the two ways the /v3 host opens a notebook without naming a thread
 * must both start a fresh chat, and the cold-load path must write that fresh
 * thread into the URL. Without the write, a technician who opens
 * `?notebook=<id>`, asks a question and reloads lands in yet another blank
 * chat, and the conversation they just had is gone from view (#3922).
 *
 * The host component is not rendered in this suite (precedent:
 * hub-host-initial-state.test.ts), so the wiring is pinned against its source;
 * the behaviour itself is covered in hub-host-logic.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");

function body(name: string): string {
  const start = host.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} must exist in hub-host.tsx`).toBeGreaterThan(-1);
  const end = host.indexOf("\n  }, [", start);
  expect(end).toBeGreaterThan(start);
  return host.slice(start, end);
}

describe("hub-host opens a notebook on a fresh chat (#4444)", () => {
  it("a sidebar project click opens a fresh thread, not the most recent one", () => {
    const onSelectProject = body("onSelectProject");
    expect(onSelectProject).toMatch(/openNotebookSelection\(nb\)/);
    expect(host).not.toMatch(/\binitialSelection\b/);
  });

  it("a cold load from the URL writes the selection back, so a reload returns to the same chat", () => {
    const loadNotebooks = body("loadNotebooks");
    const set = loadNotebooks.indexOf("setSelection(next)");
    const write = loadNotebooks.indexOf("writeSearch(searchForSelection(next))");
    expect(set).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(set);
  });

  it("an explicit thread row still opens exactly that thread (control)", () => {
    expect(body("onOpenItem")).toMatch(/threadRefFromItem\(item\.id\)[\s\S]*select\(ref\)/);
  });
});
