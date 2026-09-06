import { describe, expect, it } from "bun:test";
import {
  PROFILES,
  createShellState,
  getFixture,
  shellReducer,
  type PlatformAdapter,
} from "@factorylm/interaction";

function sourceIds(state: ReturnType<typeof createShellState>): readonly string[] {
  return state.thread.turns.flatMap((turn) =>
    turn.parts.flatMap((part) => (part.type === "source" ? [part.source.id] : [])),
  );
}

describe("shared shell reducer", () => {
  it("loads a fixture into one immutable shell model", () => {
    const before = createShellState(getFixture("general-ask"), PROFILES.web);
    const fixture = getFixture("work-run");
    const fixtureSnapshot = structuredClone(fixture);
    const after = shellReducer(before, { type: "load-fixture", fixture });

    expect(after.thread).toEqual(fixture.thread);
    expect(after.run).toEqual(fixture.run);
    expect(after.mode).toBe("work");
    expect(after.draft).toBe("");
    expect(before.thread.id).toBe("thread-general-ask");
    expect(fixture).toEqual(fixtureSnapshot);
  });

  it("switches Ask and Work without replacing the thread", () => {
    const before = createShellState(getFixture("general-ask"), PROFILES.mobile);
    const after = shellReducer(before, { type: "set-mode", mode: "work" });

    expect(after.mode).toBe("work");
    expect(after.thread.mode).toBe("work");
    expect(after.thread.id).toBe(before.thread.id);
    expect(before.thread.mode).toBe("ask");
  });

  it("selects known projects and folders only for future context", () => {
    const before = createShellState(getFixture("machine-ask"), PROFILES.web);
    const project = shellReducer(before, { type: "select-project", projectId: "project-brake-system" });
    const folder = shellReducer(project, { type: "select-folder", folderId: "folder-brake-history" });

    expect(project.activeContext).toMatchObject({
      projectId: "project-brake-system",
      machineIdentity: "not_applicable",
      evidenceAuthorization: "not_applicable",
    });
    expect(project.activeContext.machineId).toBeUndefined();
    expect(folder.activeContext).toMatchObject({
      projectId: "project-brake-system",
      folderId: "folder-brake-history",
      machineIdentity: "not_applicable",
      evidenceAuthorization: "not_applicable",
    });
    expect(before.thread.turns[0]?.context.machineId).toBe("machine-drive-a");
    expect(shellReducer(before, { type: "select-project", projectId: "missing-project" })).toBe(before);
    expect(shellReducer(before, { type: "select-folder", folderId: "missing-folder" })).toBe(before);
  });

  it("changes known machines only for future turns and fails closed", () => {
    const fixture = getFixture("machine-ask");
    const fixtureSnapshot = structuredClone(fixture);
    const before = createShellState(fixture, PROFILES.web);
    const beforeSnapshot = structuredClone(before);
    const after = shellReducer(before, { type: "select-machine", machineId: "machine-drive-b" });

    expect(after.activeContext).toMatchObject({
      machineId: "machine-drive-b",
      machineIdentity: "unconfirmed",
      evidenceAuthorization: "not_authorized",
    });
    expect(after.thread.turns).toEqual(before.thread.turns);
    expect(before).toEqual(beforeSnapshot);
    expect(fixture).toEqual(fixtureSnapshot);
    expect(shellReducer(before, { type: "select-machine", machineId: "missing-machine" })).toBe(before);
  });

  it("keeps navigation, inspector, and attachment visibility independent", () => {
    const before = createShellState(getFixture("enterprise-inspector"), PROFILES.hub);
    const navigation = shellReducer(before, { type: "set-navigation-visible", visible: false });
    const inspector = shellReducer(navigation, { type: "set-inspector-visible", visible: true });
    const attachments = shellReducer(inspector, { type: "set-attachment-menu-visible", visible: true });

    expect(attachments.navigationVisible).toBe(false);
    expect(attachments.inspectorVisible).toBe(true);
    expect(attachments.attachmentMenuVisible).toBe(true);
  });

  it("selects only a source from the current thread", () => {
    const before = createShellState(getFixture("grounded-answer"), PROFILES.hub);
    const [sourceId] = sourceIds(before);
    if (!sourceId) throw new Error("grounded fixture must include a source");
    const after = shellReducer(before, { type: "select-source", sourceId });

    expect(after.selectedSource?.id).toBe(sourceId);
    expect(shellReducer(before, { type: "select-source", sourceId: "missing-source" })).toBe(before);
  });

  it("stores draft text without changing historical state", () => {
    const before = createShellState(getFixture("general-ask"), PROFILES.web);
    const after = shellReducer(before, { type: "set-draft", draft: "  Check preload  " });

    expect(after.draft).toBe("  Check preload  ");
    expect(after.thread.turns).toEqual(before.thread.turns);
    expect(before.draft).toBe("");
  });

  it("mock-sends deterministic trimmed user turns in the same thread", () => {
    const initial = createShellState(getFixture("general-ask"), PROFILES.web);
    const before = shellReducer(initial, { type: "set-draft", draft: "  Check preload  " });
    const beforeSnapshot = structuredClone(before);
    const after = shellReducer(before, { type: "mock-send" });

    expect(after.thread.id).toBe(before.thread.id);
    expect(after.thread.turns).toHaveLength(before.thread.turns.length + 1);
    expect(after.thread.turns.at(-1)).toMatchObject({
      id: "mock-thread-general-ask-3",
      role: "user",
      lifecycle: "accepted",
      parts: [{ type: "text", text: "Check preload" }],
    });
    expect(after.thread.turns.at(-1)?.context).toEqual(before.activeContext);
    expect(after.thread.turns.at(-1)?.context).not.toBe(before.activeContext);
    expect(after.draft).toBe("");
    expect(before).toEqual(beforeSnapshot);
    expect(shellReducer(shellReducer(initial, { type: "set-draft", draft: "   " }), { type: "mock-send" })).toEqual(
      shellReducer(initial, { type: "set-draft", draft: "   " }),
    );
  });

  it("identifies only existing retryable failed turns without changing lifecycle", () => {
    const before = createShellState(getFixture("error-retry"), PROFILES.web);
    const retryableTurnId = before.thread.turns[0]?.id;
    if (!retryableTurnId) throw new Error("retry fixture must include a failed turn");
    const after = shellReducer(before, { type: "retry", turnId: retryableTurnId });

    expect(after.retryTargetTurnId).toBe(retryableTurnId);
    expect(after.thread.turns).toEqual(before.thread.turns);
    expect(after.thread.turns[0]?.lifecycle).toBe("failed");
    expect(shellReducer(before, { type: "retry", turnId: "missing-turn" })).toBe(before);
    expect(
      shellReducer(createShellState(getFixture("general-ask"), PROFILES.web), {
        type: "retry",
        turnId: "turn-general-answer",
      }),
    ).toEqual(createShellState(getFixture("general-ask"), PROFILES.web));
  });

  it("changes theme and surface profile without changing the interaction model", () => {
    const before = createShellState(getFixture("machine-ask"), PROFILES.web);
    const themed = shellReducer(before, { type: "set-theme", theme: "dark" });
    const after = shellReducer(themed, { type: "set-profile", profile: PROFILES.mobile });

    expect(after.theme).toBe("dark");
    expect(after.profile).toEqual(PROFILES.mobile);
    expect(after.thread).toEqual(before.thread);
    expect(after.activeContext).toEqual(before.activeContext);
  });

  it("exposes the injected platform boundary without calling it", () => {
    const calls = { photo: 0, file: 0, scan: 0, share: 0, back: 0 };
    const adapter: PlatformAdapter = {
      attachPhoto: async () => (calls.photo++, null),
      attachFile: async () => (calls.file++, null),
      scanMachine: async () => (calls.scan++, null),
      shareArtifact: async () => (calls.share++, "cancelled"),
      onBack: () => (calls.back++, "pass"),
    };

    shellReducer(createShellState(getFixture("attachments"), PROFILES.mobile), { type: "mock-send" });
    expect(adapter).toBeDefined();
    expect(calls).toEqual({ photo: 0, file: 0, scan: 0, share: 0, back: 0 });
  });
});
