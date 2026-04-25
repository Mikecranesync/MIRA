import { withAuth } from "next-auth/middleware";

// Explicit `secret` is required for the edge-runtime middleware to find
// the JWT signing key. next-auth/middleware defaults to reading
// process.env.NEXTAUTH_SECRET only — if that's unset and getToken throws,
// withAuth silently falls through and the request proceeds (resulting in
// a 200 instead of a 302). We use AUTH_SECRET (Auth.js v5 convention)
// throughout the rest of the stack, so plumb it explicitly here.
export default withAuth({
  pages: {
    signIn: "/login",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

export const config = {
  matcher: [
    "/((?!login|signup|api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
