import { redirect } from "next/navigation";

// Workspace events live at /event-log; Settings links here for a consistent IA.
export default function SettingsAuditLogRedirect() {
  redirect("/event-log");
}
