"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabs } from "@/components/layout/bottom-tabs";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <Sidebar role="admin" />
      <main className="flex-1 md:ml-60 pb-16 md:pb-0 overflow-auto">
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}
