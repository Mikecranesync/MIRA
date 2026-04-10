import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// 2:15am ET — full nightly manual ingest run (mirrors ingest_manuals.py cron)
export const nightlyManuals = schedules.task({
  id: "nightly-manuals",
  cron: {
    pattern: "15 2 * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("ingest"),
});

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
