import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabs } from "@/components/layout/bottom-tabs";
import { MobileTopBar } from "@/components/layout/mobile-topbar";
import { TrialBanner } from "@/components/trial-banner";

// Force dynamic rendering on all (hub)/* pages so the auth middleware
// runs on every request. Without this, pages with no data fetching
// get statically prerendered at build time and the middleware redirect
// is bypassed by the cache layer (x-nextjs-cache: HIT). Discovered
// 2026-04-25 when /hub/feed returned 200 without a session cookie.
// API routes are unaffected — they're already force-dynamic individually.
export const dynamic = "force-dynamic";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <TrialBanner />
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
