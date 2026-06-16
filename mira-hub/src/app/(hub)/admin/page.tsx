import { redirect } from "next/navigation";

// /admin is the legacy entry point; the customer-facing admin is now Settings.
export default function AdminIndexPage() {
  redirect("/settings");
}
