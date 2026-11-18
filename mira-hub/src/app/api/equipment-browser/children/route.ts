import { equipmentBrowser } from "@/capabilities/equipment-browser/browser";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return equipmentBrowser(request,"children"); }
