import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReducer } from "react";
import {
  PROFILES,
  createShellState,
  getFixture,
  shellReducer,
  type Attachment,
  type FixtureId,
  type PlatformAdapter,
  type ProjectItem,
  type ShellAction,
  type SurfaceKind,
} from "@factorylm/interaction";
import type { Dispatch, MutableRefObject, ReactNode } from "react";
import { FactoryLMShell } from "../FactoryLMShell";
import type { HostHooks } from "../parts";

export interface HarnessProps {
  readonly surface: SurfaceKind;
  readonly fixture: FixtureId;
  readonly adapter?: PlatformAdapter;
  readonly hooks?: HostHooks;
  readonly onOpenItem?: (item: ProjectItem) => void;
  readonly navigationFooter?: ReactNode;
  readonly dispatchRef?: MutableRefObject<Dispatch<ShellAction> | null>;
}

export interface RecordingAdapter extends PlatformAdapter {
  readonly calls: readonly string[];
}

export interface FakeAdapterOptions {
  readonly photo?: Attachment | null;
  readonly file?: Attachment | null;
  readonly scannedMachineId?: string | null;
  readonly share?: "shared" | "cancelled";
  readonly reject?: Error;
}

export function fakeAdapter(options: FakeAdapterOptions = {}): RecordingAdapter {
  const calls: string[] = [];
  const fail = () => {
    if (options.reject) throw options.reject;
  };
  return {
    calls,
    attachPhoto: async () => {
      calls.push("attachPhoto");
      fail();
      return options.photo ?? null;
    },
    attachFile: async () => {
      calls.push("attachFile");
      fail();
      return options.file ?? null;
    },
    scanMachine: async () => {
      calls.push("scanMachine");
      fail();
      return options.scannedMachineId ?? null;
    },
    shareArtifact: async (artifactId) => {
      calls.push(`shareArtifact:${artifactId}`);
      fail();
      return options.share ?? "cancelled";
    },
    onBack: () => {
      calls.push("onBack");
      return "pass";
    },
  };
}

export function Harness({ surface, fixture, adapter = fakeAdapter(), hooks, onOpenItem, navigationFooter, dispatchRef }: HarnessProps) {
  const [state, dispatch] = useReducer(
    shellReducer,
    createShellState(getFixture(fixture), PROFILES[surface]),
  );
  if (dispatchRef) dispatchRef.current = dispatch;

  return (
    <>
      <FactoryLMShell state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} onOpenItem={onOpenItem} navigationFooter={navigationFooter} />
      <output
        aria-label="Active context"
        data-folder-id={state.activeContext.folderId ?? ""}
        data-machine-id={state.activeContext.machineId ?? ""}
        data-project-id={state.activeContext.projectId ?? ""}
        data-draft={state.draft}
        data-mode={state.mode}
        data-retry-target={state.retryTargetTurnId ?? ""}
        data-turn-count={state.thread.turns.length}
      />
    </>
  );
}

export interface HarnessView {
  readonly container: HTMLDivElement;
  buttonNamed(name: string): HTMLButtonElement | null;
  click(element: Element): void;
  type(element: HTMLTextAreaElement | HTMLInputElement, value: string): void;
  submit(element: HTMLFormElement): void;
  flush(): Promise<void>;
  dispatch(action: ShellAction): void;
  activeContext(): { projectId: string; folderId: string; machineId: string };
  outputs(): { draft: string; mode: string; retryTarget: string; turnCount: number };
  cleanup(): void;
}

function accessibleName(button: HTMLButtonElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

export function renderHarness(props: HarnessProps): HarnessView {
  const container = document.createElement("div");
  document.body.append(container);
  const dispatchRef: MutableRefObject<Dispatch<ShellAction> | null> = { current: null };
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Harness {...props} dispatchRef={dispatchRef} />);
  });

  const output = () => {
    const context = container.querySelector<HTMLOutputElement>('[aria-label="Active context"]');
    if (!context) throw new Error("Harness did not render the active context");
    return context;
  };

  return {
    container,
    buttonNamed: (name) => Array.from(container.querySelectorAll("button"))
      .find((button) => accessibleName(button) === name) ?? null,
    click: (element) => act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }),
    type: (element, value) => act(() => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("value setter is required");
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }),
    submit: (element) => act(() => {
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }),
    flush: () => act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }),
    dispatch: (action) => act(() => {
      if (!dispatchRef.current) throw new Error("Harness dispatch is not ready");
      dispatchRef.current(action);
    }),
    activeContext: () => ({
      projectId: output().dataset.projectId ?? "",
      folderId: output().dataset.folderId ?? "",
      machineId: output().dataset.machineId ?? "",
    }),
    outputs: () => ({
      draft: output().dataset.draft ?? "",
      mode: output().dataset.mode ?? "",
      retryTarget: output().dataset.retryTarget ?? "",
      turnCount: Number(output().dataset.turnCount ?? "0"),
    }),
    cleanup: () => act(() => {
      root.unmount();
      container.remove();
    }),
  };
}
