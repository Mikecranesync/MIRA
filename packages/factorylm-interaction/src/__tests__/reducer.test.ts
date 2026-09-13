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

  it("preserves the complete offline fixture state as deeply frozen shell state", () => {
    const fixture = getFixture("offline-sync");
    const fixtureSnapshot = structuredClone(fixture);
    const state = createShellState(fixture, PROFILES.mobile);

    expect(state.offline).toEqual({
      state: "offline",
      pendingChanges: 1,
      detail: "The field note is retained locally for sync.",
    });
    expect(state.offline).not.toBe(fixture.offline);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.offline)).toBe(true);
    expect(fixture).toEqual(fixtureSnapshot);
  });

  it("replaces fixture-owned inspector fields through an immutable fixture load", () => {
    const offlineFixture = getFixture("offline-sync");
    const inspectorFixture = getFixture("enterprise-inspector");
    const offlineSnapshot = structuredClone(offlineFixture);
    const inspectorSnapshot = structuredClone(inspectorFixture);
    const before = shellReducer(
      createShellState(offlineFixture, PROFILES.web),
      { type: "set-theme", theme: "dark" },
    );
    const after = shellReducer(before, { type: "load-fixture", fixture: inspectorFixture });

    expect(after.offline).toEqual({ state: "online", pendingChanges: 0 });
    expect(after.inspector).toEqual([
      { label: "Asset binding", value: "asset-launch-2-drive-a" },
      { label: "Evidence authorization", value: "authorized" },
      { label: "Source provenance", value: "workspace_file" },
    ]);
    expect(after.inspector).not.toBe(inspectorFixture.inspector);
    expect(Object.isFrozen(after.offline)).toBe(true);
    expect(Object.isFrozen(after.inspector)).toBe(true);
    expect(Object.isFrozen(after.inspector?.[0])).toBe(true);
    expect(after.theme).toBe("dark");
    expect(after.profile).toEqual(PROFILES.web);
    expect(offlineFixture).toEqual(offlineSnapshot);
    expect(inspectorFixture).toEqual(inspectorSnapshot);
  });

  it("preserves theme and profile across fixture loads unless explicitly overridden", () => {
    const sourceSelected = shellReducer(
      createShellState(getFixture("grounded-answer"), PROFILES.web),
      { type: "select-source", sourceId: "source-f30001-manual" },
    );
    const before = shellReducer(
      shellReducer(
        shellReducer(
          shellReducer(sourceSelected, { type: "set-theme", theme: "dark" }),
          { type: "set-navigation-visible", visible: false },
        ),
        { type: "set-inspector-visible", visible: true },
      ),
      { type: "set-attachment-menu-visible", visible: true },
    );
    const implicit = shellReducer(before, { type: "load-fixture", fixture: getFixture("general-ask") });
    const explicit = shellReducer(implicit, {
      type: "load-fixture",
      fixture: getFixture("work-run"),
      profile: PROFILES.hub,
    });

    expect(implicit.theme).toBe("dark");
    expect(implicit.profile).toEqual(PROFILES.web);
    expect(implicit.draft).toBe("");
    expect(implicit.selectedSource).toBeNull();
    expect(implicit.navigationVisible).toBe(true);
    expect(implicit.inspectorVisible).toBe(false);
    expect(implicit.attachmentMenuVisible).toBe(false);
    expect(explicit.theme).toBe("dark");
    expect(explicit.profile).toEqual(PROFILES.hub);
  });

  it("switches Ask and Work without replacing the thread", () => {
    const before = createShellState(getFixture("general-ask"), PROFILES.mobile);
    const after = shellReducer(before, { type: "set-mode", mode: "work" });

    expect(after.mode).toBe("work");
    expect(after.thread.mode).toBe("work");
    expect(after.thread.id).toBe(before.thread.id);
    expect(before.thread.mode).toBe("ask");
  });

  it("keeps the current thread binding aligned with project and folder future context", () => {
    const before = createShellState(getFixture("machine-ask"), PROFILES.web);
    const project = shellReducer(before, { type: "select-project", projectId: "project-brake-system" });
    const folder = shellReducer(project, { type: "select-folder", folderId: "folder-brake-history" });

    expect(project.activeContext).toMatchObject({
      projectId: "project-brake-system",
      machineIdentity: "not_applicable",
      evidenceAuthorization: "not_applicable",
    });
    expect(project.activeContext.machineId).toBeUndefined();
    expect(project.thread).toMatchObject({ projectId: "project-brake-system" });
    expect(project.thread.folderId).toBeUndefined();
    expect(project.thread.primaryAssetId).toBeUndefined();
    expect(folder.activeContext).toMatchObject({
      projectId: "project-brake-system",
      folderId: "folder-brake-history",
      machineIdentity: "not_applicable",
      evidenceAuthorization: "not_applicable",
    });
    expect(folder.thread).toMatchObject({
      projectId: "project-brake-system",
      folderId: "folder-brake-history",
    });
    expect(folder.thread.primaryAssetId).toBeUndefined();
    expect(before.thread.turns[0]?.context.machineId).toBe("machine-drive-a");
    expect(shellReducer(before, { type: "select-project", projectId: "missing-project" })).toBe(before);
    expect(shellReducer(before, { type: "select-folder", folderId: "missing-folder" })).toBe(before);
  });

  it("changes in-scope known machines only for future turns and updates the current binding", () => {
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
    expect(after.thread).toMatchObject({
      projectId: "project-launch-2",
      folderId: "folder-drive-system",
      primaryAssetId: "asset-launch-2-drive-b",
    });
    expect(after.thread.turns).toEqual(before.thread.turns);
    expect(before).toEqual(beforeSnapshot);
    expect(fixture).toEqual(fixtureSnapshot);
    expect(shellReducer(before, { type: "select-machine", machineId: "missing-machine" })).toBe(before);
  });

  it("rejects globally known machines outside the active project or folder subtree", () => {
    const initial = createShellState(getFixture("machine-ask"), PROFILES.web);
    const brakeProject = shellReducer(initial, { type: "select-project", projectId: "project-brake-system" });
    const rejectedByProject = shellReducer(brakeProject, { type: "select-machine", machineId: "machine-drive-b" });
    const brakeFolder = shellReducer(brakeProject, { type: "select-folder", folderId: "folder-brake-history" });
    const rejectedByFolder = shellReducer(brakeFolder, { type: "select-machine", machineId: "machine-drive-b" });
    const accepted = shellReducer(brakeFolder, { type: "select-machine", machineId: "machine-drive-a" });

    expect(rejectedByProject).toBe(brakeProject);
    expect(rejectedByFolder).toBe(brakeFolder);
    expect(accepted.activeContext).toMatchObject({
      machineId: "machine-drive-a",
      machineIdentity: "unconfirmed",
      evidenceAuthorization: "not_authorized",
    });
    expect(accepted.thread).toMatchObject({
      projectId: "project-brake-system",
      folderId: "folder-brake-history",
      primaryAssetId: "asset-launch-2-drive-a",
    });
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

  it("binds mock sends to an active Work run but not an Ask thread", () => {
    const work = shellReducer(
      createShellState(getFixture("work-run"), PROFILES.web),
      { type: "set-draft", draft: "Record supply voltage." },
    );
    const ask = shellReducer(
      createShellState(getFixture("general-ask"), PROFILES.web),
      { type: "set-draft", draft: "What is preload?" },
    );

    expect(shellReducer(work, { type: "mock-send" }).thread.turns.at(-1)?.runId).toBe("run-drive-a-f30001");
    expect(shellReducer(ask, { type: "mock-send" }).thread.turns.at(-1)?.runId).toBeUndefined();
  });

  it("keeps a retained Work run out of mock turns after switching to Ask", () => {
    const work = createShellState(getFixture("work-run"), PROFILES.web);
    const ask = shellReducer(work, { type: "set-mode", mode: "ask" });
    const after = shellReducer(
      shellReducer(ask, { type: "set-draft", draft: "Summarize the inspection." }),
      { type: "mock-send" },
    );

    expect(ask.run?.id).toBe("run-drive-a-f30001");
    expect(ask.mode).toBe("ask");
    expect(ask.thread.mode).toBe("ask");
    expect(after.thread.turns.at(-1)?.runId).toBeUndefined();
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

  it("defines the complete injected platform capability boundary", async () => {
    const attachment = {
      id: "attachment-nameplate",
      name: "nameplate.jpg",
      mediaType: "image/jpeg",
      kind: "photo" as const,
      status: "ready" as const,
    };
    const adapter: PlatformAdapter = {
      attachPhoto: async () => attachment,
      attachFile: async () => null,
      attachCamera: async () => null,
      scanMachine: async () => "machine-drive-a",
      shareArtifact: async () => "cancelled",
      onBack: () => "pass",
    };

    expect(Object.keys(adapter).sort()).toEqual([
      "attachCamera",
      "attachFile",
      "attachPhoto",
      "onBack",
      "scanMachine",
      "shareArtifact",
    ]);
    expect(await adapter.attachPhoto()).toEqual(attachment);
    expect(await adapter.shareArtifact("artifact-handoff")).toBe("cancelled");
    expect(adapter.onBack()).toBe("pass");
  });
});
