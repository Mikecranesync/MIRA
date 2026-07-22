/**
 * Pure interaction-reducer tests — the "mobile touch" behavior modeled as
 * deterministic pointer sequences (no DOM). Verifies tool routing, draft ->
 * commit for each draw tool, stray-click rejection, and undo/redo history.
 */

import { describe, expect, it } from "vitest";

import { COORDINATE_SPACE } from "./schema";
import {
  canRedo,
  canUndo,
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "./reducer";

function run(actions: WorkspaceAction[], from: WorkspaceState = initialWorkspaceState): WorkspaceState {
  return actions.reduce(workspaceReducer, from);
}

const P = (x: number, y: number) => ({ x, y });

describe("tool selection", () => {
  it("selects a tool and abandons any in-progress draft", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "box" },
      { type: "POINTER_DOWN", point: P(0.1, 0.1) },
      { type: "SELECT_TOOL", tool: "point" },
    ]);
    expect(s.tool).toBe("point");
    expect(s.draft).toBeNull();
  });

  it("re-selecting the current tool with no draft is a no-op (same reference)", () => {
    const base = run([{ type: "SELECT_TOOL", tool: "highlight" }]);
    const again = workspaceReducer(base, { type: "SELECT_TOOL", tool: "highlight" });
    expect(again).toBe(base);
  });
});

describe("point tool", () => {
  it("drops a canonical point on pointer up", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "point" },
      { type: "POINTER_DOWN", point: P(0.4, 0.6) },
      { type: "POINTER_UP", point: P(0.4, 0.6) },
    ]);
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0]).toEqual({
      id: "r1",
      tool: "point",
      geometry: { type: "point", coordinate_space: COORDINATE_SPACE, x: 0.4, y: 0.6 },
    });
  });

  it("clamps an out-of-image point into the unit square", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "point" },
      { type: "POINTER_DOWN", point: P(1.4, -0.2) },
      { type: "POINTER_UP", point: P(1.4, -0.2) },
    ]);
    expect(s.annotations[0].geometry).toEqual({
      type: "point",
      coordinate_space: COORDINATE_SPACE,
      x: 1,
      y: 0,
    });
  });
});

describe("box tool", () => {
  it("commits a rect from drag corners", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "box" },
      { type: "POINTER_DOWN", point: P(0.2, 0.3) },
      { type: "POINTER_MOVE", point: P(0.5, 0.55) },
      { type: "POINTER_UP", point: P(0.5, 0.55) },
    ]);
    expect(s.annotations[0].geometry).toEqual({
      type: "rect",
      coordinate_space: COORDINATE_SPACE,
      x: 0.2,
      y: 0.3,
      width: 0.3,
      height: 0.25,
    });
  });

  it("normalizes a bottom-right -> top-left drag (negative direction)", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "box" },
      { type: "POINTER_DOWN", point: P(0.7, 0.8) },
      { type: "POINTER_UP", point: P(0.4, 0.5) },
    ]);
    expect(s.annotations[0].geometry).toMatchObject({
      type: "rect",
      x: 0.4,
      y: 0.5,
      width: 0.3,
      height: 0.3,
    });
  });

  it("discards a stray click (sub-threshold area) without committing", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "box" },
      { type: "POINTER_DOWN", point: P(0.5, 0.5) },
      { type: "POINTER_UP", point: P(0.5, 0.5) },
    ]);
    expect(s.annotations).toHaveLength(0);
    expect(s.draft).toBeNull();
    expect(canUndo(s)).toBe(false);
  });
});

describe("highlight tool", () => {
  it("commits a rect geometry tagged with the highlight tool", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "highlight" },
      { type: "POINTER_DOWN", point: P(0.1, 0.1) },
      { type: "POINTER_UP", point: P(0.9, 0.2) },
    ]);
    expect(s.annotations[0].tool).toBe("highlight");
    expect(s.annotations[0].geometry.type).toBe("rect");
  });
});

describe("pan tool", () => {
  it("does not create annotations from pointer events", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "pan" },
      { type: "POINTER_DOWN", point: P(0.2, 0.2) },
      { type: "POINTER_MOVE", point: P(0.6, 0.6) },
      { type: "POINTER_UP", point: P(0.6, 0.6) },
    ]);
    expect(s.annotations).toHaveLength(0);
    expect(s.draft).toBeNull();
  });
});

describe("undo / redo history", () => {
  const drawTwo: WorkspaceAction[] = [
    { type: "SELECT_TOOL", tool: "box" },
    { type: "POINTER_DOWN", point: P(0.1, 0.1) },
    { type: "POINTER_UP", point: P(0.3, 0.3) },
    { type: "POINTER_DOWN", point: P(0.4, 0.4) },
    { type: "POINTER_UP", point: P(0.6, 0.6) },
  ];

  it("assigns deterministic ids and stacks undo snapshots", () => {
    const s = run(drawTwo);
    expect(s.annotations.map((a) => a.id)).toEqual(["r1", "r2"]);
    expect(s.past).toHaveLength(2);
    expect(canUndo(s)).toBe(true);
    expect(canRedo(s)).toBe(false);
  });

  it("undo removes the last annotation and enables redo", () => {
    const s = run([...drawTwo, { type: "UNDO" }]);
    expect(s.annotations.map((a) => a.id)).toEqual(["r1"]);
    expect(canRedo(s)).toBe(true);
  });

  it("redo restores the undone annotation", () => {
    const s = run([...drawTwo, { type: "UNDO" }, { type: "REDO" }]);
    expect(s.annotations.map((a) => a.id)).toEqual(["r1", "r2"]);
    expect(canRedo(s)).toBe(false);
  });

  it("undo to empty then redo both back", () => {
    const s = run([...drawTwo, { type: "UNDO" }, { type: "UNDO" }]);
    expect(s.annotations).toHaveLength(0);
    expect(canUndo(s)).toBe(false);
    const r = run([{ type: "REDO" }, { type: "REDO" }], s);
    expect(r.annotations.map((a) => a.id)).toEqual(["r1", "r2"]);
  });

  it("a new commit after undo clears the redo stack (no branching)", () => {
    const s = run([
      ...drawTwo,
      { type: "UNDO" },
      { type: "POINTER_DOWN", point: P(0.7, 0.7) },
      { type: "POINTER_UP", point: P(0.9, 0.9) },
    ]);
    expect(s.annotations.map((a) => a.id)).toEqual(["r1", "r3"]);
    expect(canRedo(s)).toBe(false);
  });

  it("undo/redo are no-ops on empty stacks (same reference)", () => {
    expect(workspaceReducer(initialWorkspaceState, { type: "UNDO" })).toBe(initialWorkspaceState);
    expect(workspaceReducer(initialWorkspaceState, { type: "REDO" })).toBe(initialWorkspaceState);
  });
});

describe("clear", () => {
  it("clears all annotations and is undoable", () => {
    const s = run([
      { type: "SELECT_TOOL", tool: "box" },
      { type: "POINTER_DOWN", point: P(0.1, 0.1) },
      { type: "POINTER_UP", point: P(0.3, 0.3) },
      { type: "CLEAR" },
    ]);
    expect(s.annotations).toHaveLength(0);
    expect(canUndo(s)).toBe(true);
    const undone = workspaceReducer(s, { type: "UNDO" });
    expect(undone.annotations).toHaveLength(1);
  });

  it("clear on an empty workspace is a no-op (same reference)", () => {
    expect(workspaceReducer(initialWorkspaceState, { type: "CLEAR" })).toBe(initialWorkspaceState);
  });
});
