import path from "node:path";
import type { NextConfig } from "next";
import { API_BODY_LIMIT_BYTES } from "./server/body-limit";

// The dashboard compiles the runtime straight from its source: `@/lib/*` is
// ../foldrun-core/src/* (see tsconfig paths) and `@/docs-index` is
// ../foldrun-docs/index.ts. Those are sibling checkouts, one directory up, so
// the bundler's root is the folder holding all the foldrun-* repositories —
// otherwise Turbopack refuses to read a file "outside the project".
const root = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  // The same number proxy.ts refuses above (server/body-limit.ts): Next
  // truncates a body past this silently, so the proxy says 413 first.
  experimental: { proxyClientMaxBodySize: API_BODY_LIMIT_BYTES },
};

export default nextConfig;
