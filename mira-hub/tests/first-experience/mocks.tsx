import type { ReactNode } from "react";
// Local fixture only: no authentication, telemetry, email or database calls.
export const useRouter = () => ({ push: (url: string) => { window.location.href = url; }, replace: (url: string) => { window.location.href = url; }, refresh: () => {} });
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const useSession = () => ({ data: { user: { status: "pending", trialExpiresAt: null } } });
export async function signIn(provider: string) {
  if (provider === "google") throw new Error("Fixture provider unavailable");
  return { error: null };
}
export async function signOut({ callbackUrl }: { callbackUrl: string }) { window.location.href = callbackUrl; }
export default function Link({ href, children, ...props }: { href: string; children: ReactNode }) { return <a href={href} {...props}>{children}</a>; }
