// FactoryLM Sensor — the LOOK / READ / REPLAY instrument, hosted in the ONE
// approved bottom-sheet chrome (Sheet) so hardware BACK unwinds it through the
// transient-layer stack exactly like every other sheet: viewer → Sensor sheet
// → notebook → tab. No new chrome, no fourth notebook panel, no sixth tab
// (contract §2.1–2.2).
//
// Works with zero sources and no bound asset (§2.6): every mode renders and
// every visible action does something today. Modes that need a machine say so
// in one sentence and offer READ; nothing is disabled or "coming soon".
import { useState } from "react";
import { Sheet } from "./Sheet";
import { SENSOR_MODES, type SensorMode } from "../lib/sensor";

export function SensorSheet({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<SensorMode | null>(null);
  const current = SENSOR_MODES.find((m) => m.id === mode) ?? null;

  return (
    <Sheet label="Sensor" onClose={onClose}>
      {current === null && (
        <>
          <h3>Sensor</h3>
          <div className="meta" style={{ marginBottom: 10 }}>
            Use the phone as an instrument on this machine. Everything you
            observe lands in this notebook&apos;s conversation.
          </div>
          {SENSOR_MODES.map((m) => (
            <button
              key={m.id}
              className="sheet-option sensor-mode"
              aria-label={m.label}
              onClick={() => setMode(m.id)}
            >
              <span className="sensor-mode-label">{m.label}</span>
              <span className="meta">{m.description}</span>
            </button>
          ))}
          <button style={{ marginTop: 6 }} onClick={onClose}>
            Done
          </button>
        </>
      )}
      {current !== null && (
        <>
          <h3>{current.label}</h3>
          <div className="meta" style={{ marginBottom: 10 }}>
            {current.description}
          </div>
          <button style={{ marginTop: 6 }} onClick={() => setMode(null)}>
            ← Modes
          </button>
        </>
      )}
    </Sheet>
  );
}
