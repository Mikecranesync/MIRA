import { Capacitor } from "@capacitor/core";

/** Whether the current transport can honestly support a visible Stop control.
 *
 * Browser fetch streams propagate AbortSignal to the server. The Capacitor
 * native fetch patch buffers the response and does not, so advertising Stop
 * there would fabricate a stopped turn while the server keeps working.
 * This is presentation policy, deliberately kept out of the reusable HTTP
 * client and inside the legacy-UI lifecycle boundary.
 */
export function canCancelChatTransport(): boolean {
  return !Capacitor.isNativePlatform();
}
