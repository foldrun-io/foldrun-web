import { $t } from "@/i18n";
import { Suspense } from "react";
import { AuthCard } from "../../brand";
import { McpAuthorize } from "./authorize";

import { requestLocale } from "@/server/locale";
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("auth.mcp-authorize-page.connectAnAiApp") };
}

// An AI app (claude.ai, an MCP client) sent the person here to sign it in to
// /v1/mcp (server/mcp-oauth.ts). The page shows who is asking, where the
// answer goes and what it may do, and sends the person back to the app with
// a code — or with a no.
export default async function McpAuthorizePage() {
  await requestLocale();
  return (
    <AuthCard wide>
      <Suspense>
        <McpAuthorize />
      </Suspense>
    </AuthCard>
  );
}
