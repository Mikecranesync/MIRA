import { useState } from "react";
import { createNotebook, type Notebook } from "../api/resources";
import { apiErrorCopy } from "../lib/api-error-copy";
import "./unified.css";

/**
 * Canonical create-project route (#3765). Reuses the equipment-notebook
 * capability (`createNotebook`) as an adapter input; presentation lives here,
 * in the unified tree, without reaching back into the frozen classic
 * NotebooksTab create screen.
 */
export function UnifiedCreateProject({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (nb: Notebook) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = !busy && displayName.trim().length > 0;

  return (
    <div className="unified-root unified-create" data-testid="unified-create-project">
      <header className="unified-create__header">
        <button type="button" className="unified-create__back" onClick={onCancel}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div>
          <p className="fl-card__label">FactoryLM</p>
          <h1>New project</h1>
        </div>
      </header>

      <main className="unified-create__content">
        <form
          className="fl-card"
          aria-labelledby="unified-create-heading"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate) return;
            setBusy(true);
            setError(null);
            try {
              const nb = await createNotebook({
                displayName: displayName.trim(),
                manufacturer: manufacturer.trim() || null,
                model: model.trim() || null,
                equipmentType: equipmentType.trim() || null,
                serialNumber: serialNumber.trim() || null,
                identityStatus: "user_confirmed",
                identitySourceType: "user",
              });
              onCreated(nb);
            } catch (e) {
              setError(apiErrorCopy(e, "Could not create the project."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="fl-card__label">Machine notebook</p>
          <h2 id="unified-create-heading">Name the machine</h2>

          <label className="unified-create__field">
            Name
            <input
              value={displayName}
              placeholder="e.g. PowerFlex 525 — Line 1"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="unified-create__field">
            Manufacturer
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </label>
          <label className="unified-create__field">
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label className="unified-create__field">
            Equipment type
            <input
              value={equipmentType}
              placeholder="drive / motor / conveyor…"
              onChange={(e) => setEquipmentType(e.target.value)}
            />
          </label>
          <label className="unified-create__field">
            Serial number
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </label>

          <div className="fl-card__actions">
            <button type="submit" className="unified-create__primary" disabled={!canCreate}>
              {busy ? "Creating…" : "Create project"}
            </button>
          </div>
          {displayName.trim().length === 0 && (
            <p className="unified-create__hint">To create: give the machine a name.</p>
          )}
          {error != null && (
            <p className="unified-create__error" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
