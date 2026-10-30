// The flow a hook URL belongs to: one that exists and starts by webhook.
// Shared by GET …/hooks/<flow> (read the URL) and POST …/rotate (change it),
// so the two refuse the same things the same way (30 Oct 2026). Rotate used
// to answer 200 with a URL for a flow that did not exist, or that no
// delivery could ever start.

import { ApiError } from "./api.ts";
import { listFlows } from "@/lib/store";

export function requireWebhookFlow(tenant: string, workspace: string, flow: string): void {
  const found = listFlows(tenant, workspace).find((f) => f.name === flow);
  if (!found) throw new ApiError(`no flow "${flow}" in ${workspace}`, 404);
  if (found.trigger !== "webhook") {
    throw new ApiError(`flow "${flow}" is trigger: ${found.trigger || "manual"}, not webhook — it has no hook URL`, 409);
  }
}
