import { redirect } from "next/navigation";

// Review queue moved under the unified Settings surface (#1932). Keep this
// legacy route working as a redirect for bookmarks.
export default function AdminReviewRedirect() {
  redirect("/settings/review-queue");
}
