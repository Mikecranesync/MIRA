import type {
  ContextSnapshot,
  InteractionRun,
  InteractionThread,
  Machine,
  Project,
  ProjectFolder,
  ProjectNode,
  ShellFixture,
  SourceReference,
  SurfaceProfile,
  ThemeName,
} from "./types";

export interface ShellState {
  readonly fixtureId: string;
  readonly thread: InteractionThread;
  readonly run?: InteractionRun;
  readonly projects: readonly Project[];
  readonly machines: readonly Machine[];
  readonly activeContext: ContextSnapshot;
  readonly profile: SurfaceProfile;
  readonly theme: ThemeName;
  readonly draft: string;
  readonly selectedSource: SourceReference | null;
  readonly retryTargetTurnId: string | null;
  readonly selectedProjectId?: string;
  readonly selectedFolderId?: string;
  readonly navigationVisible: boolean;
  readonly inspectorVisible: boolean;
  readonly attachmentMenuVisible: boolean;
  readonly mode: "ask" | "work";
}

export type ShellAction =
  | { readonly type: "load-fixture"; readonly fixture: ShellFixture; readonly profile?: SurfaceProfile }
  | { readonly type: "set-mode"; readonly mode: "ask" | "work" }
  | { readonly type: "select-project"; readonly projectId: string }
  | { readonly type: "select-folder"; readonly folderId: string }
  | { readonly type: "select-machine"; readonly machineId: string }
  | { readonly type: "set-navigation-visible"; readonly visible: boolean }
  | { readonly type: "set-inspector-visible"; readonly visible: boolean }
  | { readonly type: "set-attachment-menu-visible"; readonly visible: boolean }
  | { readonly type: "select-source"; readonly sourceId: string | null }
  | { readonly type: "set-draft"; readonly draft: string }
  | { readonly type: "mock-send" }
  | { readonly type: "retry"; readonly turnId: string }
  | { readonly type: "set-theme"; readonly theme: ThemeName }
  | { readonly type: "set-profile"; readonly profile: SurfaceProfile };

function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copyValue(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, copyValue(child)]),
    ) as T;
  }
  return value;
}

function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}

function freezeState(state: ShellState): ShellState {
  return freezeValue(state);
}

function contextsEqual(left: ContextSnapshot, right: ContextSnapshot): boolean {
  return left.tenantId === right.tenantId
    && left.projectId === right.projectId
    && left.folderId === right.folderId
    && left.machineId === right.machineId
    && left.machineIdentity === right.machineIdentity
    && left.evidenceAuthorization === right.evidenceAuthorization
    && left.capturedAt === right.capturedAt;
}

function setFutureContext(state: ShellState, activeContext: ContextSnapshot, selectedProjectId?: string, selectedFolderId?: string): ShellState {
  if (
    contextsEqual(state.activeContext, activeContext)
    && state.selectedProjectId === selectedProjectId
    && state.selectedFolderId === selectedFolderId
  ) return state;
  return freezeState({
    ...state,
    activeContext,
    thread: threadForContext(state.thread, activeContext, state.machines),
    selectedProjectId,
    selectedFolderId,
  });
}

function threadForContext(
  thread: InteractionThread,
  context: ContextSnapshot,
  machines: readonly Machine[],
): InteractionThread {
  const { projectId: _projectId, folderId: _folderId, primaryAssetId: _primaryAssetId, ...rest } = thread;
  const machine = context.machineId
    ? machines.find((candidate) => candidate.id === context.machineId)
    : undefined;
  return {
    ...rest,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.folderId ? { folderId: context.folderId } : {}),
    ...(machine ? { primaryAssetId: machine.canonicalAssetId } : {}),
  };
}

function findFolder(projects: readonly Project[], folderId: string): { projectId: string; folder: ProjectFolder } | undefined {
  const visit = (nodes: readonly ProjectNode[]): ProjectFolder | undefined => {
    for (const node of nodes) {
      if (node.kind !== "folder") continue;
      if (node.id === folderId) return node;
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return undefined;
  };

  for (const project of projects) {
    const folder = visit(project.children);
    if (folder) return { projectId: project.id, folder };
  }
  return undefined;
}

function hasMachineLink(nodes: readonly ProjectNode[], machineId: string): boolean {
  return nodes.some((node) => {
    if (node.kind === "machine-link") return node.machineId === machineId;
    return node.kind === "folder" && hasMachineLink(node.children, machineId);
  });
}

function machineIsInActiveScope(state: ShellState, machineId: string): boolean {
  if (state.activeContext.folderId) {
    const folder = findFolder(state.projects, state.activeContext.folderId);
    if (!folder || folder.projectId !== state.activeContext.projectId) return false;
    return hasMachineLink(folder.folder.children, machineId);
  }
  if (!state.activeContext.projectId) return false;
  const project = state.projects.find((candidate) => candidate.id === state.activeContext.projectId);
  return Boolean(project && hasMachineLink(project.children, machineId));
}

function findSource(thread: InteractionThread, sourceId: string): SourceReference | undefined {
  for (const turn of thread.turns) {
    for (const part of turn.parts) {
      if (part.type === "source" && part.source.id === sourceId) return part.source;
    }
  }
  return undefined;
}

function isRetryableFailedTurn(thread: InteractionThread, turnId: string): boolean {
  const turn = thread.turns.find((candidate) => candidate.id === turnId);
  return turn?.lifecycle === "failed" && turn.parts.some(
    (part) => part.type === "error" && part.error.retryable,
  );
}

export function createShellState(fixture: ShellFixture, profile: SurfaceProfile): ShellState {
  const copy = copyValue(fixture);
  return freezeState({
    fixtureId: copy.id,
    thread: copy.thread,
    ...(copy.run ? { run: copy.run } : {}),
    projects: copy.projects,
    machines: copy.machines,
    activeContext: copy.activeContext,
    profile: copyValue(profile),
    theme: "light",
    draft: "",
    selectedSource: null,
    retryTargetTurnId: null,
    ...(copy.activeContext.projectId ? { selectedProjectId: copy.activeContext.projectId } : {}),
    ...(copy.activeContext.folderId ? { selectedFolderId: copy.activeContext.folderId } : {}),
    navigationVisible: true,
    inspectorVisible: false,
    attachmentMenuVisible: false,
    mode: copy.thread.mode,
  });
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "load-fixture": {
      const loaded = createShellState(action.fixture, action.profile ?? state.profile);
      return freezeState({ ...loaded, theme: state.theme });
    }

    case "set-mode":
      if (state.mode === action.mode && state.thread.mode === action.mode) return state;
      return freezeState({
        ...state,
        mode: action.mode,
        thread: { ...state.thread, mode: action.mode },
      });

    case "select-project": {
      if (!state.projects.some((project) => project.id === action.projectId)) return state;
      const activeContext: ContextSnapshot = {
        tenantId: state.activeContext.tenantId,
        projectId: action.projectId,
        machineIdentity: "not_applicable",
        evidenceAuthorization: "not_applicable",
        capturedAt: state.activeContext.capturedAt,
      };
      return setFutureContext(state, activeContext, action.projectId);
    }

    case "select-folder": {
      const match = findFolder(state.projects, action.folderId);
      if (!match) return state;
      const activeContext: ContextSnapshot = {
        tenantId: state.activeContext.tenantId,
        projectId: match.projectId,
        folderId: match.folder.id,
        machineIdentity: "not_applicable",
        evidenceAuthorization: "not_applicable",
        capturedAt: state.activeContext.capturedAt,
      };
      return setFutureContext(state, activeContext, match.projectId, match.folder.id);
    }

    case "select-machine": {
      if (!state.machines.some((machine) => machine.id === action.machineId)) return state;
      if (!machineIsInActiveScope(state, action.machineId)) return state;
      if (state.activeContext.machineId === action.machineId) return state;
      return setFutureContext(state, {
        ...state.activeContext,
        machineId: action.machineId,
        machineIdentity: "unconfirmed",
        evidenceAuthorization: "not_authorized",
      }, state.selectedProjectId, state.selectedFolderId);
    }

    case "set-navigation-visible":
      return state.navigationVisible === action.visible
        ? state
        : freezeState({ ...state, navigationVisible: action.visible });

    case "set-inspector-visible":
      return state.inspectorVisible === action.visible
        ? state
        : freezeState({ ...state, inspectorVisible: action.visible });

    case "set-attachment-menu-visible":
      return state.attachmentMenuVisible === action.visible
        ? state
        : freezeState({ ...state, attachmentMenuVisible: action.visible });

    case "select-source": {
      if (action.sourceId === null) {
        return state.selectedSource === null ? state : freezeState({ ...state, selectedSource: null });
      }
      const source = findSource(state.thread, action.sourceId);
      if (!source || state.selectedSource?.id === source.id) return state;
      return freezeState({ ...state, selectedSource: source });
    }

    case "set-draft":
      return state.draft === action.draft ? state : freezeState({ ...state, draft: action.draft });

    case "mock-send": {
      const text = state.draft.trim();
      if (!text) return state;
      const nextTurn = {
        id: `mock-${state.thread.id}-${state.thread.turns.length + 1}`,
        threadId: state.thread.id,
        role: "user" as const,
        parts: [{ type: "text" as const, text }],
        lifecycle: "accepted" as const,
        context: copyValue(state.activeContext),
        createdAt: state.thread.updatedAt,
        updatedAt: state.thread.updatedAt,
        ...(state.run ? { runId: state.run.id } : {}),
      };
      return freezeState({
        ...state,
        thread: { ...state.thread, turns: [...state.thread.turns, nextTurn] },
        draft: "",
      });
    }

    case "retry":
      if (!isRetryableFailedTurn(state.thread, action.turnId) || state.retryTargetTurnId === action.turnId) return state;
      return freezeState({ ...state, retryTargetTurnId: action.turnId });

    case "set-theme":
      return state.theme === action.theme ? state : freezeState({ ...state, theme: action.theme });

    case "set-profile":
      return state.profile === action.profile ? state : freezeState({ ...state, profile: copyValue(action.profile) });

    default:
      return state;
  }
}
