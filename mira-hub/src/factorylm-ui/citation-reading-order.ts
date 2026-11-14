import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { CITE_HREF_PREFIX, remarkCitationChips } from "@/components/equipment/notebook-markdown";

/** Use the same markdown transformation as the answer, excluding code/links. */
export function citationReadingOrder(text: string, citations: EvidenceCitation[]) {
  const parser = unified().use(remarkParse).use(remarkGfm);
  const tree = parser.runSync(parser.parse(text)) as Root;
  remarkCitationChips({ citationIds: new Set(citations.map(c => c.citationId)) })(tree);
  const result: { citation: EvidenceCitation; statement: string }[] = [];
  const seen = new Set<string>();
  const plain = (node: Root | RootContent): string => "value" in node ? node.value : "children" in node ? node.children.map(child => plain(child as RootContent)).join("") : "";
  const visit = (node: Root | RootContent, statement: string) => {
    if (["paragraph", "tableCell", "heading"].includes(node.type)) statement = plain(node);
    if (node.type === "link" && node.url.startsWith(CITE_HREF_PREFIX)) {
      const id = node.url.slice(CITE_HREF_PREFIX.length);
      const citation = citations.find(c => c.citationId === id);
      if (citation && !seen.has(id)) { seen.add(id); result.push({ citation, statement }); }
    }
    if ("children" in node) node.children.forEach(child => visit(child as RootContent, statement));
  };
  visit(tree, "");
  return result;
}
