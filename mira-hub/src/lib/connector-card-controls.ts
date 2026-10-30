/**
 * Action policy for connector cards.
 * A status label (e.g. In testing) hides Connect. An existing connection
 * still shows Disconnect so a tenant can see and revoke it.
 */
export function connectorCardControls(opts: {
  connected: boolean;
  statusLabel?: string | null;
  infoOnly?: boolean;
}): { showConnect: boolean; showDisconnect: boolean } {
  if (opts.infoOnly) {
    return { showConnect: false, showDisconnect: false };
  }
  if (opts.connected) {
    return { showConnect: false, showDisconnect: true };
  }
  if (opts.statusLabel) {
    return { showConnect: false, showDisconnect: false };
  }
  return { showConnect: true, showDisconnect: false };
}
