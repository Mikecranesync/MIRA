"use client";

import { FileText } from "lucide-react";

/**
 * Citation chips — the product's whole claim, rendered (gate E-1).
 *
 * Extracted from `namespace/NodeChat.tsx`, where this already worked, so a
 * second surface could use it rather than grow a second implementation. The
 * asset chat was emitting `sources` on the wire and rendering nothing; the
 * server even says so at the emit site — *"Emit retrieved sources up front so
 * the UI can render citation chips."* The UI did not.
 *
 * Shape matches `ManualSource` from `@/lib/manual-rag` (index / title / url /
 * page), which is what every `sources` SSE frame carries.
 */
export interface SourceChip {
  index: number;
  title: string;
  url: string | null;
  page: number | null;
}

export function SourceChips({ sources }: { sources?: readonly SourceChip[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="source-chips">
      {sources.map((s) => (
        <span
          key={`${s.index}-${s.title}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            color: "var(--foreground-muted)",
          }}
          title={s.url ?? s.title}
        >
          <FileText className="h-2.5 w-2.5" style={{ color: "var(--brand-blue)" }} />
          [{s.index}] {s.title}
          {s.page != null ? ` p.${s.page}` : ""}
        </span>
      ))}
    </div>
  );
}

export default SourceChips;
