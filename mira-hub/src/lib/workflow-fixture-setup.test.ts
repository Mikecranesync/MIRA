import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const safe = "postgres://fixture@127.0.0.1:55474/mira_wf01_test";
function setup(input: { url: string; confirm?: string; actualDatabase?: string }) {
  return JSON.parse(execFileSync(process.execPath, ["--experimental-vm-modules",
    fileURLToPath(new URL("./__tests__/workflow-setup-probe.mjs", import.meta.url)), JSON.stringify(input)],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }));
}
describe("documented --workflow setup entry (stub driver, no DDL)", () => {
  it.each(["postgres://fixture@example.invalid/mira_wf01_test", `${safe}?host=example.invalid`,
    `${safe}?options=-csearch_path=public`, "postgres://fixture@127.0.0.1/shared_test"])("refuses unsafe endpoint before driver creation: %s", (url) => {
    expect(setup({ url, confirm: "DISPOSABLE" })).toMatchObject({ configs: [], connected: 0, queries: [] });
  });
  it("requires confirmation before connection", () => {
    expect(setup({ url: safe })).toMatchObject({ configs: [], connected: 0, queries: [] });
  });
  it("checks server database identity before any bootstrap or migration write", () => {
    expect(setup({ url: safe, confirm: "DISPOSABLE", actualDatabase: "shared_test" }))
      .toMatchObject({ connected: 1, queries: ["SELECT current_database() AS db"], ended: 1 });
  });
  it("the confirmed loopback fixture reaches bootstrap using explicit checked fields", () => {
    const result = setup({ url: safe, confirm: "DISPOSABLE" });
    expect(result.configs).toEqual([{ host: "127.0.0.1", port: 55474, database: "mira_wf01_test", user: "fixture", password: "", ssl: false }]);
    expect(result.queries[0]).toBe("SELECT current_database() AS db");
    expect(result.queries).toHaveLength(2);
    expect(result.ended).toBe(1);
  });
});
