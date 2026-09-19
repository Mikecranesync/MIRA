import type { NextConfig } from "next";
import path from "node:path";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → basePath='/hub' (current behavior).
// Phase 2: NEXT_PUBLIC_BASE_PATH='' → basePath='' (hub serves at root).
// Baked at build time — changing this requires a container rebuild.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the Turbopack / file-tracing root to this app. The monorepo has
  // lockfiles above mira-hub, so Next 16 otherwise infers the tracing root as
  // the monorepo and pulls sibling packages — notably mira-bridge and its
  // multi-hundred-MB SQLite WAL — into the standalone trace (#3762). Pinning the
  // root here keeps the trace inside this self-contained app (prod code imports
  // nothing above its own dir), and makes local builds match the Docker build,
  // whose context is only mira-hub. That mismatch is why the earlier
  // out-of-root `../mira-bridge/**` exclude compiled locally yet crashed the
  // prod Turbopack build ("glob '../mira-bridge/**' is invalid, it has a prefix
  // that navigates out of the project root") — see below.
  // Hub mount PR 1 (#3839): the shared FactoryLM shell lives in ../packages/factorylm-*,
  // outside this app. The compiler root is the repo root so those sources compile, and
  // tsconfig `paths` pin react / react-dom / @assistant-ui/react to THIS app's copies so
  // the shell never resolves a second React (the mobile lane's useMemoCache trap).
  // NOTE: outputFileTracingRoot must NOT be pinned back to this dir — in Next 16 it is the
  // same knob as the Turbopack root, and pinning it makes ../packages unresolvable again.
  // Consequence: .next/standalone mirrors the repo layout (server.js under mira-hub/);
  // the Dockerfile copies it accordingly.
  turbopack: { root: path.join(import.meta.dirname, "..") },
  basePath,
  assetPrefix: basePath,
  // Dev-only (ignored by `next build`): allow phone/tablet testing over the
  // Tailscale IP. Without this, Next 16 dev rejects the HMR websocket from a
  // non-localhost origin and the client runtime never hydrates — every button
  // on the page is inert (bit us on the phone login, 2026-08-11).
  allowedDevOrigins: [
    "100.72.2.99",
    "100.83.251.23",
    "localhost",
    // tailscale serve HTTPS front door (phone testing without a firewall rule)
    "laptop-0ka3c70h.tail136e43.ts.net",
  ],
  // Next 16 buffers proxied (middleware/proxy.ts) request bodies at 10MB by
  // default — silently truncating manual uploads, which then fail multipart
  // parsing ("expected multipart/form-data" / server-action 404). Lift it just
  // above the app's own MAX_UPLOAD_MB=50 gate (route returns a clean 413 there);
  // +5mb headroom covers multipart framing overhead.
  experimental: {
    proxyClientMaxBodySize: "55mb",
    externalDir: true,
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
  // Belt-and-suspenders for #3762: never bake a SQLite database (or its WAL/SHM
  // sidecars) into the standalone output. With the tracing root pinned to
  // mira-hub above, the sibling mira-bridge data directory is already outside
  // the trace; this in-root `**/*.db*` glob additionally drops any DB file that
  // ever lands under the app root. The former `../mira-bridge/**` entry was
  // removed: an exclude glob may not navigate out of the (now pinned) project
  // root — Turbopack rejects it, which broke every production deploy.
  outputFileTracingExcludes: {
    "*": ["**/*.db*"],
  },
  // Bare-domain friendliness when the hub fronts the whole host (tailscale
  // serve / phone testing): / is outside basePath and 404s. In prod nginx owns
  // / (mira-web), so this redirect is never reached there.
  async redirects() {
    return [{ source: "/", destination: "/hub/", basePath: false, permanent: false }];
  },
};

export default nextConfig;
