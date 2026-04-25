import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/hub",
  assetPrefix: "/hub",
  // nginx-oracle.conf has `location /hub/` — that block fires nginx's auto-301
  // from /hub → /hub/. Next.js's default `trailingSlash: false` then 308s
  // /hub/ → /hub, producing an infinite redirect loop on the basePath root.
  // Forcing trailingSlash: true keeps Next.js consistent with nginx.
  trailingSlash: true,
};

export default nextConfig;
