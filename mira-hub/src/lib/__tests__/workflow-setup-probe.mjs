// Execute the documented CLI entry with a stub pg driver, never a real socket.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL, fileURLToPath } from "node:url";
const probeDirectory = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(process.argv[2]);
const entry = path.resolve(probeDirectory, "../../../scripts/setup-integration-db.mjs");
const events = { configs: [], connected: 0, queries: [], ended: 0, exit: null };
let finish;
const done = new Promise((resolve) => { finish = resolve; });
const context = vm.createContext({
  console: { log() {}, error() {} }, URL,
  process: { argv: [process.execPath, entry, "--workflow"], env: {
    TEST_DATABASE_URL: input.url, MIRA_TEST_DB_CONFIRM: input.confirm,
  }, exit(code) { events.exit = code; finish(); } },
});
class Client {
  constructor(config) { events.configs.push(config); }
  async connect() { events.connected++; }
  async query(sql) {
    events.queries.push(sql);
    if (sql === "SELECT current_database() AS db") return { rows: [{ db: input.actualDatabase ?? "mira_wf01_test" }] };
    throw new Error("fixture reached bootstrap; no DDL was executed");
  }
  async end() { events.ended++; }
}
const cache = new Map();
async function load(specifier, parent) {
  const key = specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : specifier;
  if (cache.has(key)) return cache.get(key);
  let target;
  if (key === "pg") {
    target = new vm.SyntheticModule(["default"], function () { this.setExport("default", { Client }); }, { context });
  } else if (key.startsWith("node:")) {
    const namespace = await import(key);
    target = new vm.SyntheticModule(Object.keys(namespace), function () {
      for (const name of Object.keys(namespace)) this.setExport(name, namespace[name]);
    }, { context });
  } else {
    target = new vm.SourceTextModule(fs.readFileSync(key, "utf8"), {
      context, identifier: key,
      initializeImportMeta(meta) { meta.url = pathToFileURL(key).href; },
    });
  }
  cache.set(key, target);
  await target.link((name, referencing) => load(name, referencing.identifier));
  return target;
}
(async () => {
  const timer = setTimeout(() => { throw new Error("setup probe did not finish"); }, 3000);
  await (await load(entry, entry)).evaluate();
  await done;
  clearTimeout(timer);
  process.stdout.write(JSON.stringify(events));
})().catch((err) => { console.error(err); process.exitCode = 1; });
