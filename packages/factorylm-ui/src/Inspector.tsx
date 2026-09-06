import type { ShellState } from "@factorylm/interaction";

interface InspectorProps {
  readonly state: ShellState;
}

export function Inspector({ state }: InspectorProps) {
  if (!state.profile.enterpriseInspector || !state.inspectorVisible || !state.inspector) return null;

  return <aside className="fl-shell__inspector" aria-label="Inspector">
    <h2>Inspector</h2>
    <dl>
      {state.inspector.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
    </dl>
  </aside>;
}
