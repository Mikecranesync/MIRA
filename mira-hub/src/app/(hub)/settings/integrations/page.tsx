import { redirect } from "next/navigation";

// Integrations live at /integrations; Settings links here for a consistent IA.
export default function SettingsIntegrationsRedirect() {
  redirect("/integrations");
}
