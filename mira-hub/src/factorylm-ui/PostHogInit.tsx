import Script from "next/script";
import { headers } from "next/headers";
import { posthogClientEnabled } from "@/capabilities/posthog";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

/**
 * Loads the same-origin PostHog init script on public auth pages only.
 * No-ops when `PLG_POSTHOG_KEY` is unset so staging/dev stay quiet.
 * Session replay stays off (see capabilities/posthog.ts).
 */
export async function PostHogInit() {
  if (!posthogClientEnabled()) return null;
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <Script
      id="posthog-init"
      src={`${BASE_PATH}/api/public/posthog-init`}
      strategy="afterInteractive"
      nonce={nonce || undefined}
    />
  );
}
