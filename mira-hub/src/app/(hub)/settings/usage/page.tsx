import { redirect } from "next/navigation";

// Usage lives at /usage; Settings links here for a consistent IA.
export default function SettingsUsageRedirect() {
  redirect("/usage");
}
