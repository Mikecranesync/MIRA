import type { NextConfig } from "next";
import path from "node:path";

// Phase 1: NEXT_PUBLIC_BASE_PATH unset → basePath='/hub' (current behavior).
// Phase 2: NEXT_PUBLIC_BASE_PATH='' → basePath='' (hub serves at root).
// Baked at build time — changing this requires a container rebuild.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";

// The bare specifiers the shared shell (../packages/factorylm-*) imports for React and
// the assistant-ui runtime, each pinned to THIS app's node_modules copy. Exported so the
// unit test can assert every entry resolves under mira-hub/node_modules. See the
// One-React invariant note on `turbopack` below.
//
// Value shape: Turbopack resolves a `resolveAlias` target as an import request in the
// context of the Next APP dir (this dir, `[project]/mira-hub`), NOT the turbopack root,
// and it rejects absolute filesystem paths ("server relative imports are not implemented
// yet" — verified against next 16.2.4, a `path.join(import.meta.dirname, ...)` value
// fails the build). So the target is written relative to this dir. Proof the context is
// this dir and not the repo root: the local build has no <repo>/node_modules at all and
// resolves every alias.
const hubModule = (name: string) => `./node_modules/${name}`;
export const ONE_REACT_ALIASES: Record<string, string> = {
  react: hubModule("react"),
  "react-dom": hubModule("react-dom"),
  "react/jsx-runtime": hubModule("react/jsx-runtime"),
  "react-dom/client": hubModule("react-dom/client"),
  "@assistant-ui/react": hubModule("@assistant-ui/react"),
};

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
  // One-React invariant (#3839 follow-up, review M1): with the compiler root at the
  // repo root, a package under ../packages/ that imports "react" walks UP from its own
  // dir and finds whatever <repo>/node_modules holds — the root package.json declares
  // apps/factorylm-ui-lab as a workspace, so a repo-root `bun install` hoists the lab's
  // React there, and the shell would silently load a SECOND React (the mobile lane's
  // useMemoCache trap). Two mechanisms hold the invariant:
  //   1. `turbopack.resolveAlias` (below) pins the bare specifiers the shell imports —
  //      react, react-dom, react/jsx-runtime, react-dom/client, @assistant-ui/react —
  //      to THIS app's node_modules copies (app-relative paths, see ONE_REACT_ALIASES),
  //      on every build.
  //   2. Build-time symlink `packages/node_modules -> ../mira-hub/node_modules`
  //      (Dockerfile builder stage; locally `ln -sfn ../mira-hub/node_modules
  //      packages/node_modules`), which also routes the shell's other transitive deps
  //      to the Hub's copies.
  // tsconfig `paths` does NOT pin React (it maps only @/* and @factorylm/*) — the alias
  // is the compile-time guarantee; the symlink is belt-and-suspenders.
  // Guarded by src/factorylm-ui/next-config-one-react.test.ts.
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
    resolveAlias: ONE_REACT_ALIASES,
  },
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
