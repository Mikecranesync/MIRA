import { redirect } from "next/navigation";

// The Knowledge section opens on the Map sub-tab by default.
export default function KnowledgeIndexRedirect() {
  redirect("/knowledge/map");
}
