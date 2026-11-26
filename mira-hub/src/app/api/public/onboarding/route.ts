import { requestAuthLink } from "@/capabilities/auth-link";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => requestAuthLink(request, true);
