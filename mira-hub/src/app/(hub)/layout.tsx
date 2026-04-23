import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabs } from "@/components/layout/bottom-tabs";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <Sidebar role="admin" />

      {/* Main content — offset by sidebar width on desktop */}
      <main
        className="flex-1 overflow-auto"
        style={{
          marginLeft: 0,
          paddingBottom: "var(--bottom-tab-height)",
        }}
      >
        {/* Desktop ml handled via CSS — sidebar is fixed, so we just need the margin */}
        <div className="md:ml-[var(--sidebar-width)]">
          {children}
        </div>
      </main>

      <BottomTabs />
    </div>
  );
}
