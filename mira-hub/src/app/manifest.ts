import type { MetadataRoute } from "next";
import { pwaManifest } from "@/capabilities/pwa-manifest";

// Served at <basePath>/manifest.webmanifest; public in middleware's matcher (#4363).
export default function manifest(): MetadataRoute.Manifest {
  return pwaManifest(process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub");
}
