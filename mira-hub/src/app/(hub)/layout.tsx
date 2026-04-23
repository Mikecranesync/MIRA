import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabs } from "@/components/layout/bottom-tabs";
import { MobileTopBar } from "@/components/layout/mobile-topbar";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Mobile-only sticky top bar */}
      <MobileTopBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar role="admin" />

        {/* Main content — offset by sidebar width on desktop */}
        <main
          className="flex-1 overflow-auto"
          style={{ paddingBottom: "var(--bottom-tab-height)" }}
        >
          <div className="md:ml-[var(--sidebar-width)]">
            {children}
          </div>
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
