// THE canonical capability-aware mobile navigation model — the frozen 5-tab
// contract from docs/specs/hub-mobile-spec.md (Workorders | Schedule | Chat |
// Assets | More), in tab order. One definition; the shell renders from it and
// nothing else defines tabs. Visibility is capability-FILTERED and fail-closed:
// a tab with a `capability` is shown only when /api/me lists it — no
// capabilities data ⇒ least privilege ⇒ hidden.

export type TabId = "workorders" | "schedule" | "chat" | "assets" | "more";

export interface TabDef {
  id: TabId;
  title: string;
  icon: string; // simple glyph for the skeleton shell
  /** Capability required to SEE the tab; undefined = visible to any session. */
  capability?: string;
}

export const TABS: readonly TabDef[] = [
  { id: "workorders", title: "Workorders", icon: "🛠" },
  { id: "schedule", title: "Schedule", icon: "📅" },
  { id: "chat", title: "Chat", icon: "💬" },
  { id: "assets", title: "Assets", icon: "⚙" },
  { id: "more", title: "More", icon: "☰" },
] as const;

export function visibleTabs(capabilities: string[] | null | undefined): TabDef[] {
  const caps = new Set(capabilities ?? []); // null/undefined ⇒ empty ⇒ fail closed
  return TABS.filter((t) => !t.capability || caps.has(t.capability));
}

/** Action-level gate for buttons inside tabs (create WO, complete PM, …). */
export function can(capabilities: string[] | null | undefined, cap: string): boolean {
  return new Set(capabilities ?? []).has(cap);
}
