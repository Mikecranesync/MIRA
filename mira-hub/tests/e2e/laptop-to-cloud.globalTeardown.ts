/** Kill the offline contextualizer spawned in globalSetup. */
import fs from "node:fs";
import path from "node:path";

const OFFLINE_STATE = path.join(__dirname, ".state", "offline.json");

export default async function globalTeardown() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(OFFLINE_STATE, "utf-8"));
    if (pid) {
      // Kill the detached process tree (Windows-safe).
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
      console.log(`[teardown] stopped offline contextualizer (pid ${pid})`);
    }
  } catch {
    /* nothing to clean up */
  }
}
