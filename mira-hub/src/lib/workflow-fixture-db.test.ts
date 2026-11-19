import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { workflowDatabaseConfig } from "../../tests/workflow/disposable-db";

const url = "postgres://fixture@127.0.0.1:55474/mira_wf01_test";
describe("WF-01 effective disposable endpoint", () => {
  it("rejects an authority/driver host disagreement without connecting", () => {
    const unsafe = `${url}?host=example.invalid`;
    expect(new URL(unsafe).hostname).toBe("127.0.0.1");
    expect(Reflect.get(new Client({ connectionString: unsafe }), "host")).toBe("example.invalid");
    expect(() => workflowDatabaseConfig(unsafe, "DISPOSABLE")).toThrow();
  });
  it.each(["host=/tmp", "hostaddr=192.0.2.1", "port=5432", "dbname=other", "service=shared", "options=-csearch_path=public", "%68ost=example.invalid"])("refuses connection option %s", (option) => {
    expect(() => workflowDatabaseConfig(`${url}?${option}`, "DISPOSABLE")).toThrow();
  });
  it.each([undefined, "", "YES"])("requires explicit confirmation (%s)", (confirm) => {
    expect(() => workflowDatabaseConfig(url, confirm)).toThrow();
  });
  it.each(["postgres://fixture@example.invalid/mira_wf01_test", "postgres://fixture@127.0.0.1/wrong", "https://fixture@127.0.0.1/mira_wf01_test", "postgres://127.0.0.1/mira_wf01_test", "postgres://fixture@127.0.0.1:0/mira_wf01_test"])("refuses unsafe config %s", (unsafe) => {
    expect(() => workflowDatabaseConfig(unsafe, "DISPOSABLE")).toThrow();
  });
  it.each([url, "postgresql://fixture@[::1]:55474/mira_wf01_test"])("uses only the checked endpoint for %s", (safe) => {
    const config = workflowDatabaseConfig(safe, "DISPOSABLE");
    const client = new Client(config);
    expect(config.connectionString).toBeUndefined();
    expect(Reflect.get(client, "host")).toBe(safe.includes("[::1]") ? "::1" : "127.0.0.1");
    expect(Reflect.get(client, "database")).toBe("mira_wf01_test");
    expect(Reflect.get(client, "port")).toBe(55474);
  });
  it("does not inherit endpoint overrides from ambient PostgreSQL variables", () => {
    const prior = { PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT, PGDATABASE: process.env.PGDATABASE };
    try {
      process.env.PGHOST = "example.invalid"; process.env.PGPORT = "6543"; process.env.PGDATABASE = "shared";
      const client = new Client(workflowDatabaseConfig(url, "DISPOSABLE"));
      expect(Reflect.get(client, "host")).toBe("127.0.0.1");
      expect(Reflect.get(client, "port")).toBe(55474);
      expect(Reflect.get(client, "database")).toBe("mira_wf01_test");
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
