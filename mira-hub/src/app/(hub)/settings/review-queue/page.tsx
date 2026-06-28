"use client";

import { ReviewQueue } from "@/components/review/review-queue";

// Platform review surface. The component self-gates: on a 401/403 from the
// review API it renders a clean no-access panel (never a raw "HTTP 403"). The
// nav link to this page is only shown to users with the review_queue.read
// capability, so a plain workspace owner never sees it. (#1932)
export default function SettingsReviewQueuePage() {
  return <ReviewQueue />;
}
