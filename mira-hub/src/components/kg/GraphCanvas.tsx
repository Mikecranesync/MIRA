"use client";

import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

// react-force-graph-2d touches window/canvas → must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export interface GraphCanvasData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function GraphCanvas({
  data,
  onNodeClick,
  onLinkClick,
}: {
  data: GraphCanvasData;
  onNodeClick?: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
}) {
  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor="#0b0f1a"
      nodeAutoColorBy="type"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeVal={(n: any) => 1 + (n as GraphNode).degree}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeLabel={(n: any) => `${(n as GraphNode).label} — ${(n as GraphNode).type}`}
      nodeRelSize={4}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkColor={(l: any) => ((l as GraphLink).state === "proposed" ? "#6b7280" : "#3a4252")}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkWidth={(l: any) => ((l as GraphLink).state === "proposed" ? 0.5 : 1)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onNodeClick={(n: any) => onNodeClick?.(n as GraphNode)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onLinkClick={(l: any) => onLinkClick?.(l as GraphLink)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkLineDash={(l: any) => ((l as GraphLink).state === "proposed" ? [4, 3] : null)}
      cooldownTicks={120}
    />
  );
}
