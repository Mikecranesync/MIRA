// DataSourceAdapter — the contract every backend implements so the UI is vendor-neutral.
// Implementations: mockAdapter (now), and later historianAdapter (the bench trend service),
// and ignition / allen-bradley / modbus / mqtt-sparkplug / opcua / factory-io / openplc /
// csv adapters. The UI depends ONLY on this interface, never on a vendor SDK.
//
//   connect():        Promise<void>            — establish the source
//   browse():         Promise<Tag[]>           — the tag catalog (normalized via createTag)
//   subscribe(onUpd, intervalMs, onStatus?): () => void
//                                                — start live pushes; returns unsubscribe.
//                                                 onUpd(updates[]) — value updates:
//                                                   [{id, currentValue, quality, timestamp,
//                                                     lastChangedTimestamp?}]
//                                                 onStatus(state, label) — OPTIONAL feed health
//                                                   so the UI never shows a green chip over a
//                                                   dead feed. state: "ok"|"warn"|"alarm".
//   disconnect():     Promise<void>
//
// An adapter MUST report quality honestly (good|uncertain|bad|stale) and SHOULD include a
// timestamp; the UI surfaces "timestamp unavailable" / "STALE" rather than faking liveness.

export class DataSourceAdapter {
  async connect() {}
  async browse() { return []; }
  subscribe(_onUpdate, _intervalMs, _onStatus) { return () => {}; }
  async disconnect() {}
}
