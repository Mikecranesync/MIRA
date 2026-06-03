import { redirect } from "next/navigation";

// /library was the standalone KB browser. Library now lives inside the
// Knowledge section as the "Manuals" sub-tab — keep the route as a permanent
// redirect so any saved link, bookmark, or QR code still resolves.
export default function LegacyLibraryRedirect() {
  redirect("/knowledge/manuals");
}
