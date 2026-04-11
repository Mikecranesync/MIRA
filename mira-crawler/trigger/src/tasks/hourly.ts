import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// Runs every hour — checks vendor sitemaps for updated/new manual pages
export const checkSitemaps = schedules.task({
  id: "check-sitemaps",
  cron: {
    pattern: "0 * * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("sitemaps"),
});

// Runs every hour — ingests any chunks queued in manual_cache but not yet embedded
export const ingestPending = schedules.task({
  id: "ingest-pending",
  cron: {
    pattern: "0 * * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("ingest"),
});
