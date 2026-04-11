import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// Runs every 15 minutes — polls RSS feeds for new content
export const pollRssFeeds = schedules.task({
  id: "poll-rss-feeds",
  cron: {
    pattern: "*/15 * * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("rss"),
});

// Runs every 15 minutes — scans Google Drive watch folder for new files
export const scanWatchFolder = schedules.task({
  id: "scan-watch-folder",
  cron: {
    pattern: "*/15 * * * *",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("gdrive"),
});
