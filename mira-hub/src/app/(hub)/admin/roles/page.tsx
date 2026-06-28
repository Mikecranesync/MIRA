import { redirect } from "next/navigation";

// Roles & permissions moved under Settings (#1932). The old /admin/roles page
// rendered a hardcoded matrix with fabricated user counts; the new page shows
// the real derived capability model.
export default function AdminRolesRedirect() {
  redirect("/settings/roles");
}
