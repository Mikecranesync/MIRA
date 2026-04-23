import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/hub",
  assetPrefix: "/hub",
};

export default nextConfig;
