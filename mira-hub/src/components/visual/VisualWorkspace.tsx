"use client";

/**
 * VisualWorkspace — the shared FactoryLM visual annotation surface (PR V1).
 *
 * A dependency-free React 19 + HTML Canvas shell over the pure geometry/
 * interaction core in `@/lib/visual`. It renders a raster image, a tool palette
 * (Point / Box / Highlight / Pan), and Undo/Redo/Clear, and turns real pointer/
 * wheel events into normalized-original annotations via the frozen
 * `factorylm.visual-region.v1` contract.
 *
 * Deliberately dependency-free (no react-konva, no radix, no cva): the same
 * component can later host the Telegram Mini App (V3) and other surfaces (§23)
 * without a viewer-library fork, and it avoids touching mira-hub's frozen
 * package lockfile. All trust/inference is out of scope for V1 — this is the
 * viewer + geometry only (PRD §20).
 *
 * Styling follows the FactoryLM design tokens in `globals.css`: muted-normal
 * surfaces, the brand accent reserved for the active tool/selection, and no
 * hardcoded hex (canvas colors are resolved from CSS custom properties at draw
 * time).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  canRedo,
  canUndo,
  initialWorkspaceState,
  workspaceReducer,
  type Annotation,
  type Tool,
} from "@/lib/visual/reducer";
import {
  DEFAULT_VIEWPORT,
  imageScreenRect,
  normalizedToScreen,
  panBy,
  screenToNormalized,
  zoomAt,
  type ScreenPoint,
  type Size,
  type ViewportState,
} from "@/lib/visual/viewport";

export interface VisualWorkspaceProps {
  /** Image (evidence) to annotate. */
  imageSrc: string;
  /** Natural pixel size of the ORIGINAL image — the normalization reference. */
  imageWidth: number;
  imageHeight: number;
  /** Tool selected on mount. */
  initialTool?: Tool;
  /** Called whenever the committed annotation set changes. */
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  className?: string;
  /** Accessible label for the annotation canvas. */
  ariaLabel?: string;
}

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: "point", label: "Point", hint: "Drop a point marker" },
  { tool: "box", label: "Box", hint: "Draw a rectangle around a region" },
  { tool: "highlight", label: "Highlight", hint: "Highlight a region" },
  { tool: "pan", label: "Pan", hint: "Drag to pan the image" },
];

/** Resolve a `--token` to its computed color, for Canvas 2D (no hardcoded hex). */
function token(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export default function VisualWorkspace({
  imageSrc,
  imageWidth,
  imageHeight,
  initialTool = "box",
  onAnnotationsChange,
  className,
  ariaLabel = "Annotation canvas",
}: VisualWorkspaceProps) {
  const [state, dispatch] = useReducer(workspaceReducer, {
    ...initialWorkspaceState,
    tool: initialTool,
  });
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const panLast = useRef<ScreenPoint | null>(null);

  const imageSize = useMemo<Size>(
    () => ({ width: imageWidth, height: imageHeight }),
    [imageWidth, imageHeight],
  );

  // Notify parent when the committed set changes.
  useEffect(() => {
    onAnnotationsChange?.(state.annotations);
  }, [state.annotations, onAnnotationsChange]);

  // Load the image (display only; coordinate math uses the natural size prop).
  useEffect(() => {
    setImageReady(false);
    if (typeof window === "undefined") return;
    const img = new window.Image();
    img.decoding = "async";
    img.onload = () => {
      imageRef.current = img;
      setImageReady(true);
    };
    img.src = imageSrc;
    return () => {
      img.onload = null;
    };
  }, [imageSrc]);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw image + annotations + draft.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const { width, height } = containerSize;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const accent = token(container, "--brand-blue", "#2563EB");
    const muted = token(container, "--foreground-subtle", "#94A3B8");

    // Image.
    if (imageRef.current) {
      const r = imageScreenRect(containerSize, imageSize, viewport);
      ctx.drawImage(imageRef.current, r.x, r.y, r.width, r.height);
    }

    const toScreen = (nx: number, ny: number) =>
      normalizedToScreen({ x: nx, y: ny }, containerSize, imageSize, viewport);

    const drawRect = (
      g: { x?: number; y?: number; width?: number; height?: number },
      fill: boolean,
    ) => {
      const tl = toScreen(g.x ?? 0, g.y ?? 0);
      const br = toScreen((g.x ?? 0) + (g.width ?? 0), (g.y ?? 0) + (g.height ?? 0));
      const w = br.x - tl.x;
      const h = br.y - tl.y;
      if (fill) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = accent;
        ctx.fillRect(tl.x, tl.y, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(tl.x, tl.y, w, h);
    };

    const drawPoint = (g: { x?: number; y?: number }) => {
      const p = toScreen(g.x ?? 0, g.y ?? 0);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const a of state.annotations) {
      if (a.geometry.type === "point") drawPoint(a.geometry);
      else drawRect(a.geometry, a.tool === "highlight");
    }

    // Draft (in-progress), drawn muted.
    if (state.draft) {
      const { start, current, tool } = state.draft;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = muted;
      if (tool === "point") {
        drawPoint({ x: current.x, y: current.y });
      } else {
        const x = Math.min(start.x, current.x);
        const y = Math.min(start.y, current.y);
        drawRect(
          { x, y, width: Math.abs(start.x - current.x), height: Math.abs(start.y - current.y) },
          tool === "highlight",
        );
      }
      ctx.restore();
    }
  }, [containerSize, imageSize, viewport, state.annotations, state.draft, imageReady]);

  const toNorm = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const screen: ScreenPoint = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
      return { screen, norm: screenToNormalized(screen, containerSize, imageSize, viewport) };
    },
    [containerSize, imageSize, viewport],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (state.tool === "pan") {
        panLast.current = { x: e.clientX, y: e.clientY };
        return;
      }
      dispatch({ type: "POINTER_DOWN", point: toNorm(e).norm });
    },
    [state.tool, toNorm],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (state.tool === "pan") {
        if (!panLast.current) return;
        setViewport((vp) => panBy(vp, e.clientX - panLast.current!.x, e.clientY - panLast.current!.y));
        panLast.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!state.draft) return;
      dispatch({ type: "POINTER_MOVE", point: toNorm(e).norm });
    },
    [state.tool, state.draft, toNorm],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (state.tool === "pan") {
        panLast.current = null;
        return;
      }
      dispatch({ type: "POINTER_UP", point: toNorm(e).norm });
    },
    [state.tool, toNorm],
  );

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const anchor: ScreenPoint = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewport((vp) => zoomAt(vp, factor, anchor, containerSize, imageSize));
    },
    [containerSize, imageSize],
  );

  const toolButton = (t: Tool, label: string, hint: string) => {
    const active = state.tool === t;
    return (
      <button
        key={t}
        type="button"
        aria-pressed={active}
        title={hint}
        onClick={() => dispatch({ type: "SELECT_TOOL", tool: t })}
        className={
          "h-8 rounded-lg px-3 text-xs font-medium transition-colors" +
          (active ? " text-white" : "")
        }
        style={
          active
            ? { backgroundColor: "var(--brand-blue)" }
            : {
                backgroundColor: "var(--surface-1)",
                color: "var(--foreground-muted)",
              }
        }
      >
        {label}
      </button>
    );
  };

  const undoable = canUndo(state);
  const redoable = canRedo(state);

  return (
    <div className={className} data-testid="visual-workspace">
      <div
        className="flex items-center gap-1.5 rounded-lg p-1.5"
        role="toolbar"
        aria-label="Annotation tools"
        style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border-default)" }}
      >
        {TOOLS.map(({ tool, label, hint }) => toolButton(tool, label, hint))}
        <span className="mx-1 h-5 w-px" style={{ backgroundColor: "var(--border-default)" }} />
        <button
          type="button"
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={!undoable}
          aria-label="Undo"
          className="h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "REDO" })}
          disabled={!redoable}
          aria-label="Redo"
          className="h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
        >
          Redo
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "CLEAR" })}
          disabled={state.annotations.length === 0}
          aria-label="Clear all annotations"
          className="h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
        >
          Clear
        </button>
        <span className="ml-auto pr-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
          {state.annotations.length} region{state.annotations.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative mt-2 w-full overflow-hidden rounded-lg"
        style={{
          height: 480,
          backgroundColor: "var(--surface-2)",
          border: "1px solid var(--border-default)",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label={ariaLabel}
          className="absolute inset-0 h-full w-full"
          style={{ cursor: state.tool === "pan" ? "grab" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        />
      </div>
    </div>
  );
}
