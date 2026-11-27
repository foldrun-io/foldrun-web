// One URL format (owner, 23 Nov 2026: "a unified format for our URLs", the
// dashboard too): every route of this app is under /v1 — `app/v1/…` — on
// the dashboard's address for its own pages' calls and on the API host
// (`https://api.foldrun.dev/v1/…`) for programs. The path carries the
// generation, v1; the dated `Foldrun-Version` header carries every change
// inside it. There is no /api.
//
// On the API host the gateway answers the model routes below, before this
// app (foldrun-infra public-ingress.yaml), so no route of this app may take
// one of their names: tests/v1-path.test.ts holds that, and the account's
// own usage is `/v1/account/usage` because `/v1/usage` is one key's spend.

/** The gateway's routes on the API host (exact paths). */
export const V1_MODEL_ROUTES: readonly string[] = [
  "/v1/messages",
  "/v1/messages/count_tokens",
  "/v1/models",
  "/v1/usage",
  "/v1/foldrun/transcribe",
  "/v1/foldrun/browse",
  "/v1/foldrun/review",
];

/** Names under /v1 that belong to the gateway as a whole (anything below
 *  them too): never a route of this app. */
export const V1_GATEWAY_PREFIXES: readonly string[] = ["/v1/messages", "/v1/models", "/v1/usage", "/v1/foldrun"];
