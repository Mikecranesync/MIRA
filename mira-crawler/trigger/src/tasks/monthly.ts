import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// 4:00am ET 1st of month — ingest foundational KB content (standards, NEC, OSHA docs)
export const monthlyFoundational = schedules.task({
  id: "monthly-foundational",
  cron: {
    pattern: "0 4 1 * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("foundational"),
});

// 5:00am ET 1st of month — process confirmed equipment photos from takeout_staging into KB
export const monthlyPhotos = schedules.task({
  id: "monthly-photos",
  cron: {
    pattern: "0 5 1 * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("photos"),
});

// 4:00am ET 15th of month — scrape and embed new patent filings for equipment fault patterns
export const monthlyPatents = schedules.task({
  id: "monthly-patents",
  cron: {
    pattern: "0 4 15 * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("patents"),
});
