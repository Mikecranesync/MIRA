"use client";

import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

// react-force-graph-2d touches window/canvas → must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export interface GraphCanvasData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Muted, intentional palette — calm on near-black. RED IS RESERVED FOR FAULTS.
const TYPE_COLORS: Record<string, string> = {
  equipment: "#5e9bd1",
  component: "#6fb39a",
  electrical_component: "#6fb39a",
  manual: "#9b8cc6",
  work_order: "#c7a35a",
  pm_task: "#c7a35a",
  part: "#8aa0b3",
  fault_code: "#d77a7a", // reserved red — faults/alerts only
  fault: "#d77a7a",
  plant: "#6c8ebf",
  area: "#6c8ebf",
  line: "#6c8ebf",
};
const DEFAULT_NODE = "#7c8aa0";

// Restrained matrix/signal-green for relationship lines.
const VERIFIED_LINK = "94,234,212";
const PROPOSED_LINK = "120,150,135";
const HALO = "94,234,212";
const TRACE = "245,217,10";

function rgba(rgb: string, a: number): string {
  return `rgba(${rgb},${a})`;
}
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function nodeRadius(deg: number): number {
  return 2 + Math.min(deg, 8) * 0.45; // graph units, bounded (no giant bubbles)
}

export function GraphCanvas({
  data,
  onNodeClick,
  onLinkClick,
  highlightNodeIds,
  intensity = 0,
}: {
  data: GraphCanvasData;
  onNodeClick?: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
  highlightNodeIds?: Set<string>;
  /** 0..1 knowledge density → subtly brightens the verified lattice. */
  intensity?: number;
}) {
  const hasHighlight = !!highlightNodeIds && highlightNodeIds.size > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const endId = (v: any): string => (typeof v === "string" ? v : v?.id);
  const traced = (l: GraphLink): boolean =>
    hasHighlight && highlightNodeIds!.has(endId(l.source)) && highlightNodeIds!.has(endId(l.target));
  const lift = Math.min(Math.max(intensity, 0), 1);
  // Skip the per-node glow gradient on very large graphs to protect mobile perf.
  const heavy = data.nodes.length > 600;

  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      nodeRelSize={4}
      d3VelocityDecay={0.28}
      cooldownTicks={120}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeLabel={(n: any) => `${(n as GraphNode).label} · ${(n as GraphNode).type}`}
      nodeCanvasObjectMode={() => "replace"}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
        const n = node as GraphNode & { x: number; y: number };
        const r = nodeRadius(n.degree ?? 0);
        const isHi = hasHighlight && highlightNodeIds!.has(n.id);
        const dim = hasHighlight && !isHi;
        const base = nodeColor(n.type);
        const alpha = dim ? 0.35 : 1;
        // soft glow (depth cue)
        if (!heavy) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2.6);
          g.addColorStop(0, hexToRgba(base, (isHi ? 0.55 : 0.22) * alpha));
          g.addColorStop(1, hexToRgba(base, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 2.6, 0, 2 * Math.PI);
          ctx.fill();
        }
        // core marker
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = hexToRgba(isHi ? "#f5d90a" : base, alpha);
        ctx.fill();
        // thin ring for depth
        ctx.lineWidth = 0.6 / scale;
        ctx.strokeStyle = `rgba(255,255,255,${0.18 * alpha})`;
        ctx.stroke();
        // selected / highlighted halo
        if (isHi) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 2.5, 0, 2 * Math.PI);
          ctx.strokeStyle = rgba(HALO, 0.85);
          ctx.lineWidth = 1 / scale;
          ctx.stroke();
        }
        // label only when zoomed in (text-fade), muted
        if (scale > 1.6 && !dim) {
          ctx.font = `${7 / scale}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = "rgba(203,213,225,0.72)";
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y + r + 7 / scale);
        }
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
        const n = node as GraphNode & { x: number; y: number };
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, nodeRadius(n.degree ?? 0) + 2, 0, 2 * Math.PI);
        ctx.fill();
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkColor={(l: any) => {
        const link = l as GraphLink;
        if (hasHighlight) return traced(link) ? rgba(TRACE, 0.9) : "rgba(40,46,58,0.3)";
        if (link.state === "proposed") return rgba(PROPOSED_LINK, 0.28);
        return rgba(VERIFIED_LINK, 0.4 + 0.22 * lift); // verified lattice brightens with density
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkWidth={(l: any) => {
        const link = l as GraphLink;
        if (hasHighlight && traced(link)) return 2;
        return link.state === "proposed" ? 0.5 : 1.1;
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkLineDash={(l: any) => ((l as GraphLink).state === "proposed" ? [3, 3] : null)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onNodeClick={(n: any) => onNodeClick?.(n as GraphNode)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onLinkClick={(l: any) => onLinkClick?.(l as GraphLink)}
    />
  );
}

function nodeColor(type: string): string {
  return TYPE_COLORS[type] ?? DEFAULT_NODE;
}
