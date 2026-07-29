/**
 * Pure interaction reducer for the shared visual workspace (PR V1).
 *
 * All annotation logic — tool selection, pointer-driven draft creation, commit,
 * and the undo/redo history — lives here as a pure `(state, action) => state`
 * function over normalized-original coordinates. It never touches React, the
 * DOM, or a Canvas, so the "mobile touch" behavior is verified as deterministic
 * pointer sequences under vitest's `node` environment; the component
 * (`VisualWorkspace.tsx`) is a thin shell that translates real pointer events
 * into these actions via `viewport.ts`.
 *
 * Every committed annotation carries a CANONICAL geometry
 * (`factorylm.visual-region.v1`), so a box drawn here is contract-identical to
 * one produced by the Python side.
 */

import { canonicalGeometry } from "./canonical";
import type { Geometry } from "./schema";
import { clampNormalized, type NormalizedPoint } from "./viewport";

/** The four V1 tools. `pan` produces no annotation (the component pans the viewport). */
export type Tool = "point" | "box" | "highlight" | "pan";

/** A tool that yields an annotation. */
export type DrawTool = Exclude<Tool, "pan">;

export interface Annotation {
  id: string;
  tool: DrawTool;
  geometry: Geometry;
}

export interface DraftAnnotation {
  tool: DrawTool;
  start: NormalizedPoint;
  current: NormalizedPoint;
}

export interface WorkspaceState {
  tool: Tool;
  annotations: Annotation[];
  draft: DraftAnnotation | null;
  /** Undo stack: past snapshots of `annotations`. */
  past: Annotation[][];
  /** Redo stack: future snapshots of `annotations`. */
  future: Annotation[][];
  /** Monotonic id source — deterministic, no Math.random / Date.now. */
  nextId: number;
}

export type WorkspaceAction =
  | { type: "SELECT_TOOL"; tool: Tool }
  | { type: "POINTER_DOWN"; point: NormalizedPoint }
  | { type: "POINTER_MOVE"; point: NormalizedPoint }
  | { type: "POINTER_UP"; point: NormalizedPoint }
  | { type: "POINTER_CANCEL" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "CLEAR" };

export const initialWorkspaceState: WorkspaceState = {
  tool: "box",
  annotations: [],
  draft: null,
  past: [],
  future: [],
  nextId: 1,
};

/**
 * Minimum normalized side length for a box/highlight to be considered
 * intentional. Anything smaller is treated as a stray click and discarded (a tap
 * with the box tool shouldn't leave a zero-area rectangle). ~1.6px on a 1600px
 * sheet.
 */
export const MIN_BOX_DIMENSION = 0.001;

function rectGeometry(start: NormalizedPoint, current: NormalizedPoint): Geometry | null {
  const a = clampNormalized(start);
  const b = clampNormalized(current);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width < MIN_BOX_DIMENSION || height < MIN_BOX_DIMENSION) return null;
  // Corners are clamped to [0,1], so x+width <= 1 and y+height <= 1 hold.
  return canonicalGeometry({ type: "rect", x, y, width, height });
}

function draftGeometry(draft: DraftAnnotation): Geometry | null {
  if (draft.tool === "point") {
    const p = clampNormalized(draft.current);
    return canonicalGeometry({ type: "point", x: p.x, y: p.y });
  }
  return rectGeometry(draft.start, draft.current);
}

/** Commit an annotation: push an undo snapshot, clear redo, append. */
function commit(state: WorkspaceState, annotation: Annotation): WorkspaceState {
  return {
    ...state,
    annotations: [...state.annotations, annotation],
    draft: null,
    past: [...state.past, state.annotations],
    future: [],
    nextId: state.nextId + 1,
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "SELECT_TOOL":
      // Switching tools abandons any in-progress draft.
      return state.tool === action.tool && state.draft === null
        ? state
        : { ...state, tool: action.tool, draft: null };

    case "POINTER_DOWN": {
      if (state.tool === "pan") return state; // component handles viewport panning
      const point = action.point;
      return { ...state, draft: { tool: state.tool, start: point, current: point } };
    }

    case "POINTER_MOVE": {
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, current: action.point } };
    }

    case "POINTER_UP": {
      const draft = state.draft;
      if (!draft) return state;
      const geometry = draftGeometry({ ...draft, current: action.point });
      if (!geometry) return { ...state, draft: null }; // stray click -> discard
      const annotation: Annotation = {
        id: `r${state.nextId}`,
        tool: draft.tool,
        geometry,
      };
      return commit(state, annotation);
    }

    case "POINTER_CANCEL":
      return state.draft === null ? state : { ...state, draft: null };

    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        annotations: previous,
        draft: null,
        past: state.past.slice(0, -1),
        future: [state.annotations, ...state.future],
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        annotations: next,
        draft: null,
        past: [...state.past, state.annotations],
        future: state.future.slice(1),
      };
    }

    case "CLEAR": {
      if (state.annotations.length === 0 && state.draft === null) return state;
      return {
        ...state,
        annotations: [],
        draft: null,
        past: state.annotations.length ? [...state.past, state.annotations] : state.past,
        future: [],
      };
    }

    default:
      return state;
  }
}

export const canUndo = (state: WorkspaceState): boolean => state.past.length > 0;
export const canRedo = (state: WorkspaceState): boolean => state.future.length > 0;
