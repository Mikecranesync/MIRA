import type { Namespace } from "@/lib/i3x";
import { MIRA_TYPE_NAMESPACE_URI } from "@/lib/i3x";

/** The namespaces the server exposes. MVP: the MIRA type vocabulary namespace. */
export function listNamespaces(): Namespace[] {
  return [{ uri: MIRA_TYPE_NAMESPACE_URI, displayName: "MIRA Industrial Types" }];
}
