import type { ServerInfo } from "@/lib/i3x/types";

/**
 * The /info payload. MIRA is a READ-ONLY i3X server:
 *   - update.current  = false   (no PUT /objects/value)
 *   - update.history  = false   (no PUT /objects/history)
 *   - query.history   = true    (history read from a tag_events window)
 *   - subscribe.stream= false   (sync-mode subscriptions only in MVP; SSE later)
 *
 * Read-only is doctrine (.claude/rules/fieldbus-readonly.md + SaaS scope guard)
 * AND fully i3X-conformant — writes and SSE are MAY, not MUST. i3X requires all
 * four flags to be present regardless of support level.
 */

/** The i3X spec version MIRA targets. */
export const I3X_SPEC_VERSION = "1.0";

export function serverInfo(): ServerInfo {
  return {
    specVersion: I3X_SPEC_VERSION,
    serverName: "MIRA",
    capabilities: {
      query: { history: true },
      update: { current: false, history: false },
      subscribe: { stream: false },
    },
  };
}
