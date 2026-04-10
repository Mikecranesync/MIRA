import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_mira-ingest",
  runtime: "node",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
    },
  },
  dirs: ["src/tasks"],
});
