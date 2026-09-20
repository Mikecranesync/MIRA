import type { NextConfig } from "next";
import path from "node:path";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → basePath='/hub' (current behavior).
// Phase 2: NEXT_PUBLIC_BASE_PATH='' → basePath='' (hub serves at root).
// Baked at build time — changing this requires a container rebuild.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

const nextConfig: NextConfig = {
  output: "standalone",
  // Compiler / file-tracing root. The monorepo has lockfiles above mira-hub, so
  // Next 16 otherwise infers the tracing root as the monorepo and pulls sibling
  // packages — notably mira-bridge and its multi-hundred-MB SQLite WAL — into the
  // standalone trace (#3762). An out-of-root `../mira-bridge/**` exclude compiled
  // locally yet crashed the prod Turbopack build ("glob '../mira-bridge/**' is
  // invalid, it has a prefix that navigates out of the project root"), so the
  // trace is bounded by an in-root glob instead — see outputFileTracingExcludes.
  //
  // Hub mount PR 1 (#3839): the shared FactoryLM shell lives in ../packages/factorylm-*,
  // OUTSIDE this app, so the compiler root is the REPO ROOT (`turbopack.root` below),
  // not this dir. That is what lets ../packages compile into the Hub bundle. In Next 16
  // `outputFileTracingRoot` is the same knob as the Turbopack root, so it must NOT be
  // pinned back to this dir — doing so makes ../packages unresolvable again.
  // Consequence: .next/standalone mirrors the repo layout (server.js under mira-hub/);
  // the Dockerfile copies it accordingly.
  //
  // One React (#3839 follow-up): Turbopack bundles Next's own vendored React
  // (next/dist/compiled/react*) for every app-dir module, the ../packages shell
  // sources included, so a second React cannot reach the bundle from
  // <repo>/node_modules or anywhere else. A `turbopack.resolveAlias` pin of the
  // react specifiers was tried and refuted with instrumented builds: it changed
  // nothing about what is bundled, and the react/jsx-runtime entry actually
  // redirected the app-wide client JSX runtime to the installed copy (harmless only
  // while byte-identical), so it was dropped. What IS load-bearing is the
  // build-time symlink `packages/node_modules -> ../mira-hub/node_modules`: tsc has
  // no resolveAlias and walks up from ../packages, so without it the type-check
  // cannot find react / @assistant-ui types for the shared packages. The Dockerfile
  // builder stage and every CI install step create it (locally:
  // `ln -sfn ../mira-hub/node_modules packages/node_modules`).
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
    // Next 16.3 (#3870 bump) switched the build type-check to the project-local
    // `tsc` CLI by default, which checks the COMPLETE tsconfig project — test
    // files included — with no Next-side filtering. The 16.2 compiler-API path
    // skips `__tests__/`, `*.test.*` and `*.spec.*` diagnostics, which is what
    // let `next build` pass with the known test-only type errors. Keep the API
    // checker so a security bump does not change which files gate the build.
    useTypeScriptCli: false,
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
  // #3762: never bake a SQLite database (or its WAL/SHM sidecars) into the
  // standalone output. The compiler root is the REPO ROOT (see turbopack.root
  // above), so the sibling mira-bridge data directory IS inside the tracing root;
  // this `**/*.db*` glob is what keeps every DB file — mira-bridge's WAL included —
  // out of the trace. It is an in-root glob on purpose: the former
  // `../mira-bridge/**` entry navigated out of the (then mira-hub) project root,
  // which Turbopack rejects and which broke every production deploy.
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
