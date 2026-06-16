import { NextResponse, type NextRequest } from "next/server";
import { API_BASE } from "@/lib/config";

// Route Handler at the basePath root. We had a Server Component page.tsx
// here calling redirect("/feed"), but Next.js 16 standalone + basePath has
// a bug where redirect() from a Server Component never produces an HTTP
// redirect at runtime — the response comes back chunked, 0 bytes, no
// Location header. (See feedback_nextjs16_standalone_redirect_broken.)
//
// Route Handlers don't go through that broken path — they use NextResponse
// directly, the same primitive every src/app/api/auth/**/*.ts callback uses
// successfully in production.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`${API_BASE}/feed/`, req.url));
}
