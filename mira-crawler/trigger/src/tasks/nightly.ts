import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// NOTE: nightly-manuals removed — hourly ingest-pending in hourly.ts covers the same use case.
//       See docs/superpowers/plans/2026-04-09-24-7-kb-ingest-pipeline.md (Arch-1)

// 3:00am ET — download and embed new YouTube transcript content
export const nightlyYoutube = schedules.task({
  id: "nightly-youtube",
  cron: {
    pattern: "0 3 * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("youtube"),
});

// 3:30am ET — full Google Drive sync and ingest
export const nightlyGdrive = schedules.task({
  id: "nightly-gdrive",
  cron: {
    pattern: "30 3 * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("gdrive"),
});

// 4:00am ET — generate nightly KB health and ingest summary report
export const nightlyReport = schedules.task({
  id: "nightly-report",
  cron: {
    pattern: "0 4 * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("report"),
});
