import { redirect } from "next/navigation";

// /proposals moved into the Knowledge section as the "Suggestions" sub-tab.
export default function ProposalsRedirect() {
  redirect("/knowledge/suggestions");
}
