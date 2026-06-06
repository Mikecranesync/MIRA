import { KnowledgeTabs } from "./KnowledgeTabs";

// Unified "Knowledge" section: Manuals (KB), Map (relationship graph),
// Suggestions (propose/verify queue) share one tab + one sidebar item.
export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <KnowledgeTabs />
      <div>{children}</div>
    </div>
  );
}
