import { redirect } from "next/navigation";

// Without this, Next.js 16 prerenders this page as a static /index.html at
// build time. The build catches the redirect() throw, serializes the intent
// as an RSC payload (`NEXT_REDIRECT;replace;/feed;307;`), and ships the
// "error" template HTML — but at runtime the standalone server doesn't
// honor that buried payload, so /hub/ comes back 200 with empty <body>.
// Forcing dynamic rendering runs redirect() at request time where it
// actually produces an HTTP 307. (See feedback_nextjs_dynamic_for_auth_middleware.)
export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/feed");
}
