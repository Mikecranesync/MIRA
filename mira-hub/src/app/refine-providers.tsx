"use client";

import { Refine } from "@refinedev/core";
import { SessionProvider } from "next-auth/react";
import { hubDataProvider } from "@/providers/data-provider";
import { authProvider } from "@/providers/auth-provider";
import { accessControlProvider } from "@/providers/access-control";

export function RefineProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/hub/api/auth">
      <Refine
        dataProvider={hubDataProvider}
        authProvider={authProvider}
        accessControlProvider={accessControlProvider}
        resources={[
          { name: "feed",        list: "/feed" },
          { name: "workorders",  list: "/workorders",  create: "/workorders/new", show: "/workorders/:id" },
          { name: "assets",      list: "/assets",      show: "/assets/:id" },
          { name: "documents",   list: "/documents" },
          { name: "parts",       list: "/parts" },
          { name: "schedule",    list: "/schedule" },
          { name: "requests",    list: "/requests" },
          { name: "reports",     list: "/reports" },
          { name: "team",        list: "/team" },
          { name: "admin/users", list: "/admin/users" },
        ]}
        options={{ disableTelemetry: true }}
      >
        {children}
      </Refine>
    </SessionProvider>
  );
}
