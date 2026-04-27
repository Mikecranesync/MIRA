import type { NextConfig } from "next";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → '/hub' (identical to today).
// Phase 2: set NEXT_PUBLIC_BASE_PATH='' at build time → hub at root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  assetPrefix: basePath,
  // When basePath='/hub': nginx location /hub/ fires an auto-301 /hub → /hub/.
  // trailingSlash:true keeps Next.js consistent so it doesn't 308 back, avoiding
  // an infinite redirect loop.  At root (basePath='') this is harmless.
  trailingSlash: true,
};

export default nextConfig;
