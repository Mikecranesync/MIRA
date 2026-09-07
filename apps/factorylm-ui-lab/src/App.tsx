import {
  FIXTURE_IDS,
  PROFILES,
  createShellState,
  getFixture,
  shellReducer,
  type FixtureId,
  type ShellState,
  type SurfaceKind,
  type ThemeName,
} from "@factorylm/interaction";
import { FactoryLMShell } from "@factorylm/ui";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createLabAdapter } from "./fake-adapter";

export const LAB_SURFACES = ["public", "web", "mobile", "hub"] as const satisfies readonly SurfaceKind[];
export const LAB_THEMES = ["light", "dark"] as const satisfies readonly ThemeName[];
export const LAB_VIEWPORTS = ["fluid", "390x844", "412x915", "768x1024", "1440x900", "1720x1000"] as const;
export type LabViewport = (typeof LAB_VIEWPORTS)[number];

export interface LabState {
  readonly surface: SurfaceKind;
  readonly scenario: FixtureId;
  readonly theme: ThemeName;
  readonly viewport: LabViewport;
  /** Shell-only rendering, used inside the fixed-viewport frame. */
  readonly embed: boolean;
}

const DEFAULT_LAB: LabState = { surface: "web", scenario: "grounded-answer", theme: "light", viewport: "fluid", embed: false };

function pick<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Every lab control is addressable from the query string; unknown values fall back to the default. */
export function parseLabState(search: string): LabState {
  const params = new URLSearchParams(search);
  return {
    surface: pick(LAB_SURFACES, params.get("surface"), DEFAULT_LAB.surface),
    scenario: pick(FIXTURE_IDS, params.get("scenario"), DEFAULT_LAB.scenario),
    theme: pick(LAB_THEMES, params.get("theme"), DEFAULT_LAB.theme),
    viewport: pick(LAB_VIEWPORTS, params.get("viewport"), DEFAULT_LAB.viewport),
    embed: params.get("embed") === "1",
  };
}

export function labSearch(lab: LabState, options: { readonly embed?: boolean } = {}): string {
  const params = new URLSearchParams({ surface: lab.surface, scenario: lab.scenario, theme: lab.theme });
  if (!options.embed && lab.viewport !== "fluid") params.set("viewport", lab.viewport);
  if (options.embed) params.set("embed", "1");
  return `?${params.toString()}`;
}

function initialShell(lab: LabState): ShellState {
  const state = createShellState(getFixture(lab.scenario), PROFILES[lab.surface]);
  return lab.theme === "light" ? state : shellReducer(state, { type: "set-theme", theme: lab.theme });
}

export interface AppProps {
  /** Query string that seeds the lab; defaults to the document location. */
  readonly search?: string;
  /** Receives the mirrored query string; defaults to history.replaceState. */
  readonly onSearch?: (search: string) => void;
}

function replaceSearch(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

export function App({ search = window.location.search, onSearch = replaceSearch }: AppProps = {}) {
  const [lab, setLab] = useState(() => parseLabState(search));
  const [state, dispatch] = useReducer(shellReducer, lab, initialShell);
  const [adapterCalls, setAdapterCalls] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const adapter = useMemo(() => createLabAdapter(
    () => ({
      activeMachineId: stateRef.current.activeContext.machineId,
      machineIds: stateRef.current.machines.map((machine) => machine.id),
    }),
    () => setAdapterCalls((count) => count + 1),
  ), []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    if (lab.embed) return;
    onSearch(labSearch(lab));
  }, [lab, onSearch]);

  const update = (patch: Partial<LabState>) => {
    const next = { ...lab, ...patch };
    setLab(next);
    if (patch.scenario !== undefined) dispatch({ type: "load-fixture", fixture: getFixture(next.scenario), profile: PROFILES[next.surface] });
    if (patch.surface !== undefined) dispatch({ type: "set-profile", profile: PROFILES[next.surface] });
    if (patch.theme !== undefined) dispatch({ type: "set-theme", theme: next.theme });
  };

  // The lab is the host here: Retry is offered only because a host can re-send,
  // and the mock host records the request in the adapter log.
  const shell = <FactoryLMShell
    state={state}
    dispatch={dispatch}
    adapter={adapter}
    hooks={{ onRetry: (turnId) => adapter.note(`onRetry:${turnId}`) }}
  />;
  if (lab.embed) return shell;

  const [width, height] = lab.viewport === "fluid" ? [0, 0] : lab.viewport.split("x").map(Number);
  const log = adapter.log();
  void adapterCalls;

  return <div className="lab" data-viewport={lab.viewport}>
    <header className="lab__controls" aria-label="Lab controls">
      <span className="lab__brand">FactoryLM UI Lab</span>
      <label>Surface
        <select aria-label="Surface" value={lab.surface} onChange={(event) => update({ surface: event.currentTarget.value as SurfaceKind })}>
          {LAB_SURFACES.map((surface) => <option key={surface} value={surface}>{surface}</option>)}
        </select>
      </label>
      <label>Scenario
        <select aria-label="Scenario" value={lab.scenario} onChange={(event) => update({ scenario: event.currentTarget.value as FixtureId })}>
          {FIXTURE_IDS.map((scenario) => <option key={scenario} value={scenario}>{getFixture(scenario).title}</option>)}
        </select>
      </label>
      <label>Viewport
        <select aria-label="Viewport" value={lab.viewport} onChange={(event) => update({ viewport: event.currentTarget.value as LabViewport })}>
          {LAB_VIEWPORTS.map((viewport) => <option key={viewport} value={viewport}>{viewport}</option>)}
        </select>
      </label>
      <button type="button" aria-label={`Theme: ${lab.theme}`} aria-pressed={lab.theme === "dark"} onClick={() => update({ theme: lab.theme === "light" ? "dark" : "light" })}>
        {lab.theme === "light" ? "Light" : "Dark"}
      </button>
      <button type="button" aria-label="Reset scenario" onClick={() => update({ scenario: lab.scenario })}>Reset</button>
      <details className="lab__log">
        <summary>Adapter log ({log.length})</summary>
        <ol aria-label="Adapter log">{log.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol>
      </details>
    </header>
    <div className="lab__stage">
      {lab.viewport === "fluid"
        ? shell
        : <iframe
          className="lab__frame"
          title={`Lab viewport ${lab.viewport}`}
          src={`/${labSearch(lab, { embed: true })}`}
          width={width}
          height={height}
        />}
    </div>
  </div>;
}
