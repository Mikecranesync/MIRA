// Shared test constants. Import from here instead of hardcoding URLs.
// Phase 1: HUB_URL unset → hub at https://app.factorylm.com/hub (current).
// Phase 2: HUB_URL=https://app.factorylm.com → hub at root.
export const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
