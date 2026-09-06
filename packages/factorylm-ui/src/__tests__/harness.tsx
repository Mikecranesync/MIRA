import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReducer } from "react";
import {
  PROFILES,
  createShellState,
  getFixture,
  shellReducer,
  type FixtureId,
  type PlatformAdapter,
  type SurfaceKind,
} from "@factorylm/interaction";
import { FactoryLMShell } from "../FactoryLMShell";

export interface HarnessProps {
  readonly surface: SurfaceKind;
  readonly fixture: FixtureId;
  readonly adapter?: PlatformAdapter;
}

export function fakeAdapter(): PlatformAdapter {
  return {
    attachPhoto: async () => null,
    attachFile: async () => null,
    scanMachine: async () => null,
    shareArtifact: async () => "cancelled",
    onBack: () => "pass",
  };
}

export function Harness({ surface, fixture, adapter = fakeAdapter() }: HarnessProps) {
  const [state, dispatch] = useReducer(
    shellReducer,
    createShellState(getFixture(fixture), PROFILES[surface]),
  );

  return (
    <>
      <FactoryLMShell state={state} dispatch={dispatch} adapter={adapter} />
      <output
        aria-label="Active context"
        data-folder-id={state.activeContext.folderId ?? ""}
        data-machine-id={state.activeContext.machineId ?? ""}
        data-project-id={state.activeContext.projectId ?? ""}
      />
    </>
  );
}

export interface HarnessView {
  readonly container: HTMLDivElement;
  buttonNamed(name: string): HTMLButtonElement | null;
  click(element: Element): void;
  activeContext(): { projectId: string; folderId: string; machineId: string };
  cleanup(): void;
}

export function renderHarness(props: HarnessProps): HarnessView {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Harness {...props} />);
  });

  return {
    container,
    buttonNamed: (name) => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === name) ?? null,
    click: (element) => act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }),
    activeContext: () => {
      const context = container.querySelector<HTMLOutputElement>('[aria-label="Active context"]');
      if (!context) throw new Error("Harness did not render the active context");
      return {
        projectId: context.dataset.projectId ?? "",
        folderId: context.dataset.folderId ?? "",
        machineId: context.dataset.machineId ?? "",
      };
    },
    cleanup: () => act(() => {
      root.unmount();
      container.remove();
    }),
  };
}
