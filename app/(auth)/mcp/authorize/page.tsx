import { Suspense } from "react";
import { McpAuthorize } from "./authorize";

export const metadata = { title: "Connect an AI app" };

// An AI app (claude.ai, an MCP client) sent the person here to sign it in to
// /api/mcp (server/mcp-oauth.ts). The page shows who is asking, where the
// answer goes and what it may do, and sends the person back to the app with
// a code — or with a no.
export default function McpAuthorizePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md">
        <Suspense>
          <McpAuthorize />
        </Suspense>
      </div>
    </main>
  );
}
