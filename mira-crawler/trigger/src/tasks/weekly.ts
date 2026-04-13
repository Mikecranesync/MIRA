import { schedules } from "@trigger.dev/sdk";
import { triggerBridgeTask } from "../lib/bridge";

// 3:00am ET Sunday — run Apify discovery crawl for new vendor manual sources
export const weeklyDiscovery = schedules.task({
  id: "weekly-discovery",
  cron: {
    pattern: "0 3 * * 0",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("discover"),
});

// 4:00am ET Sunday — scrape Reddit maintenance communities for new Q&A content
export const weeklyReddit = schedules.task({
  id: "weekly-reddit",
  cron: {
    pattern: "0 4 * * 0",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("reddit"),
});

// 5:00am ET Sunday — check KB chunks for staleness and re-embed if source updated
export const weeklyFreshness = schedules.task({
  id: "weekly-freshness",
  cron: {
    pattern: "0 5 * * 0",
    timezone: "America/New_York",
  },
  run: async () => triggerBridgeTask("freshness"),
});
