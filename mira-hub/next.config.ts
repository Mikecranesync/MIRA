import type { NextConfig } from "next";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → basePath='/hub' (current behavior).
// Phase 2: NEXT_PUBLIC_BASE_PATH='' → basePath='' (hub serves at root).
// Baked at build time — changing this requires a container rebuild.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  assetPrefix: basePath,
  // nginx-oracle.conf has `location /hub/` — that block fires nginx's auto-301
  // from /hub → /hub/. Next.js's default `trailingSlash: false` then 308s
  // /hub/ → /hub, producing an infinite redirect loop on the basePath root.
  // Forcing trailingSlash: true keeps Next.js consistent with nginx.
  trailingSlash: true,
};

export default nextConfig;
