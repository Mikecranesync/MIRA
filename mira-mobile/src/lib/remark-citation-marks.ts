// remark plugin: turn `[n]` citation marks inside markdown TEXT nodes into
// `<cite data-cite-id="n">` elements, so the renderer can mount the existing
// citation chip inside a rendered list item / table cell / paragraph
// (RNDR-1). The string is never pre-split — block structure stays intact.
// `<cite>` is a real HTML element that markdown cannot emit without HTML
// passthrough (which is off), so there is no collision with model output.
//
// Pure splitting lives in citation-marks.ts (unit-tested); this file is only
// the tree walk (`unist-util-visit`, MIT).
import type { Root, Text, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";
import { splitCitationMarks } from "./citation-marks";

export function remarkCitationMarks(opts: { knownIds: ReadonlySet<string> }) {
  const { knownIds } = opts;
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number" || !node.value.includes("[")) return;
      const segs = splitCitationMarks(node.value, knownIds);
      // Untouched node: no known chip and no unknown marker was stripped.
      // (A node whose ONLY marks are unknown must still be rewritten, or the
      // bare `[n]` the splitter removed would render anyway — same rule as the
      // Hub's remarkCitationChips, which also strips with an empty id set.)
      const unchanged = segs.length === 1 && segs[0].kind === "text" && segs[0].text === node.value;
      if (unchanged) return;
      const replacement: PhrasingContent[] = segs.map((s) =>
        s.kind === "text"
          ? ({ type: "text", value: s.text } as Text)
          : ({
              type: "text",
              value: `[${s.id}]`,
              data: { hName: "cite", hProperties: { "data-cite-id": s.id } },
            } as Text),
      );
      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length; // skip what we just inserted
    });
  };
}
