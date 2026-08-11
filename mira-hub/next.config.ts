import type { NextConfig } from "next";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → basePath='/hub' (current behavior).
// Phase 2: NEXT_PUBLIC_BASE_PATH='' → basePath='' (hub serves at root).
// Baked at build time — changing this requires a container rebuild.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  assetPrefix: basePath,
  // Dev-only (ignored by `next build`): allow phone/tablet testing over the
  // Tailscale IP. Without this, Next 16 dev rejects the HMR websocket from a
  // non-localhost origin and the client runtime never hydrates — every button
  // on the page is inert (bit us on the phone login, 2026-08-11).
  allowedDevOrigins: ["100.72.2.99", "100.83.251.23", "localhost"],
  // Next 16 buffers proxied (middleware/proxy.ts) request bodies at 10MB by
  // default — silently truncating manual uploads, which then fail multipart
  // parsing ("expected multipart/form-data" / server-action 404). Lift it just
  // above the app's own MAX_UPLOAD_MB=50 gate (route returns a clean 413 there);
  // +5mb headroom covers multipart framing overhead.
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },
  // #1899: unpdf loads its PDF.js engine via a runtime `import('unpdf/pdfjs')`.
  // Under `output: "standalone"`, @vercel/nft does not trace that dynamic
  // subpath import, so unpdf is dropped from `.next/standalone/node_modules`
  // and the deployed server throws `Cannot find module 'unpdf/pdfjs'` on every
  // PDF folder upload (POST /api/namespace/node/[id]/files → ingestPdfToNode).
  // Marking it external keeps it out of the bundle and copies the full package
  // (incl. dist/pdfjs.mjs) into the standalone node_modules, so the runtime
  // import resolves. See docs/tech-debt + node-knowledge-ingest.ts.
  serverExternalPackages: ["unpdf"],
  // Drop the `X-Powered-By: Next.js` response header — small fingerprint-leak
  // cleanup (#1762). No functional impact; Next.js never relied on it.
  poweredByHeader: false,
  // nginx-oracle.conf has `location /hub/` — that block fires nginx's auto-301
  // from /hub → /hub/. Next.js's default `trailingSlash: false` then 308s
  // /hub/ → /hub, producing an infinite redirect loop on the basePath root.
  // Forcing trailingSlash: true keeps Next.js consistent with nginx.
  trailingSlash: true,
};

export default nextConfig;
