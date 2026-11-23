// Every API operation is reached by the CLI and by the dashboard — or is
// listed here, with why it is not. The rule: a feature ships in the API, the
// dashboard, the CLI and the docs (the docs half is tests/consistency.test.ts).
// scripts/surface-coverage.mjs finds the calls; this holds the exceptions.
//
// A new route fails here until something calls it from both sides or it is
// listed below with a reason a reviewer can check. An exception that is no
// longer needed (the call now exists) fails too, so the list cannot rot.
//
//   node --import ./tests/register.mjs --test tests/surface-coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { operations, cliReach, dashboardReach } from "../scripts/surface-coverage.mjs";
import { billingPresent, isBillingRoute } from "./billing-files.ts";

const SESSION = "a person's own sign-in, profile or security — session only, a key is refused";
const CALLBACK = "called by something else holding its own proof, not by a person: ";

/** Operations the CLI does not call, and why. */
const NOT_IN_CLI: Record<string, string> = {
  "GET /v1/pricing": "the public catalogue for foldrun.io and foldrun.ir, which read it from a browser; `foldrun usage rates` shows the same figures through the account's own /v1/account/usage/rates",
  "POST /v1/billing/partner/plans/offer": CALLBACK + "foldrun.ir's signed storefront calls (coding plans); people buy at foldrun.ir",
  "POST /v1/billing/partner/signups": CALLBACK + "foldrun.ir's signed storefront calls (a sign-up link for a customer with no account); the person opens the account on /signup",
  "POST /v1/billing/partner/plans": CALLBACK + "foldrun.ir's signed storefront calls (coding plans); people buy at foldrun.ir",
  "POST /v1/account/close": "closing an account is the owner's, in person, in Settings",
  "GET /v1/billing/plans": "the platform plans' catalogue, no longer sold since 23 Nov 2026 (owner): `foldrun billing plans` reads /v1/billing/coding-plan, whose entitlement shows a legacy plan honoured to its paid-through date",
  "POST /v1/billing/subscribe": "buying a platform plan, no longer sold since 23 Nov 2026 (owner): `foldrun billing plan pro|max` buys the foldrun subscription (/v1/billing/coding-plan); a legacy plan is still cancelled with DELETE",
  "POST /v1/oauth/handoff/[id]": "accepting a terminal-started connection is a signed-in person's, in the browser; the CLI opens the page (/v1/oauth/start answers its URL)",
  ...Object.fromEntries(
    [
      "POST /v1/auth/email", "POST /v1/auth/forgot", "POST /v1/auth/login", "POST /v1/auth/login/code", "POST /v1/auth/login/code/verify", "POST /v1/auth/logout",
      "POST /v1/auth/mfa/disable", "POST /v1/auth/mfa/enable", "POST /v1/auth/mfa/setup", "POST /v1/auth/mfa/verify",
      "POST /v1/auth/password", "POST /v1/auth/reset", "GET /v1/auth/session",
      "GET /v1/auth/sessions", "DELETE /v1/auth/sessions", "POST /v1/auth/signup",
      "GET /v1/auth/verify", "POST /v1/auth/verify/resend",
      "POST /v1/team/transfer",
      "PATCH /v1/me/onboarding",
    ].map((op) => [op, SESSION]),
  ),
  "GET /v1/mcp/oauth/authorize": "an AI app's OAuth sign-in, approved by a person in the browser at /mcp/authorize; the CLI signs in with `foldrun login` and serves MCP with `foldrun mcp`",
  "POST /v1/mcp/oauth/authorize": "an AI app's OAuth sign-in, approved by a person in the browser at /mcp/authorize",
  "POST /v1/mcp/oauth/register": CALLBACK + "an AI app registering itself for OAuth (RFC 7591)",
  "POST /v1/mcp/oauth/token": CALLBACK + "an AI app trading its code or refresh token for tokens",
  "POST /v1/mcp/oauth/revoke": CALLBACK + "an AI app handing back its own token (RFC 7009); people end a connection with DELETE /v1/mcp/connections/[id]",
  "GET /v1/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "PUT /v1/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "DELETE /v1/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "GET /v1/cli/authorize": "the browser's half of `foldrun login`",
  "POST /v1/cli/authorize": "the browser's half of `foldrun login`",
  "GET /v1/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email (`foldrun approve` uses /runs/<id>/approve)",
  "POST /v1/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email (`foldrun approve` uses /runs/<id>/approve)",
  "POST /v1/events/[tenant]/[workspace]/[runId]": CALLBACK + "a run's event URL, for `wait: event`",
  "POST /v1/hooks/[tenant]/[workspace]/[flow]": CALLBACK + "a flow's webhook URL (`foldrun flow hook` prints it)",
  "POST /v1/inbox/[tenant]/[workspace]/[flow]": CALLBACK + "inbound mail for a flow",
  // FOL-94: `foldrun billing credit` is retired with it — it answers 404 to all.
  "POST /v1/billing": "answers 404 to every caller: credit by hand is the platform console's capped adjustment",
  "GET /v1/billing/confirm": CALLBACK + "Stripe Checkout's return",
  "POST /v1/billing/stripe": CALLBACK + "Stripe's signed webhook",
  "GET /v1/billing/partner/topups/rate": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/quote": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "GET /v1/billing/partner/topups": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "GET /v1/billing/partner/topups/[id]": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/authority": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/paid": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/failed": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/unsubscribe": CALLBACK + "the one-click unsubscribe in a mail",
  "GET /v1/oauth/callback": CALLBACK + "an OAuth provider's redirect",
  "GET /v1/metrics": CALLBACK + "a Prometheus scrape",
  "GET /s/[token]": CALLBACK + "a share link, opened by whoever has it",
  "HEAD /s/[token]": CALLBACK + "a share link, opened by whoever has it",
  // Reached, by a path the scanner cannot evaluate.
  "GET /v1/workspaces/[workspace]/flows": "`foldrun flow ls --to`: remoteListCmd, `/v1/workspaces/${ws}/${kind}`",
  "POST /v1/workspaces/[workspace]/agents": "`foldrun agent new --platform`: platformScaffold, `/v1/workspaces/${ws}/${kind}`",
  "POST /v1/workspaces/[workspace]/flows": "`foldrun flow new --platform`: platformScaffold, `/v1/workspaces/${ws}/${kind}`",
  "POST /v1/workspaces/[workspace]/deploy": "`foldrun deploy`: the URL is built from the platform's origin",
  "PATCH /v1/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable; `flow set` reaches it as /flows/${flow}",
  "DELETE /v1/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable; `flow rm` reaches it as /flows/${flow}",
};

const SERVER = (page: string) => `the page renders it on the server, from the function the route calls: ${page}`;
const SEEN = (where: string) => `reached by a call the scanner cannot evaluate: ${where}`;

/** Operations the dashboard does not call through /v1, and why. */
const NOT_IN_DASHBOARD: Record<string, string> = {
  // Session messages (19 Nov 2026): sent and read where the conversation is
  // held — foldrun code, scripts; a run's page lists the ones its turn
  // included, from the run record (no call to these routes).
  "GET /v1/workspaces/[workspace]/sessions/[context]/messages": "read where the conversation is held (foldrun code); the run page shows a turn's included messages from its record",
  "POST /v1/workspaces/[workspace]/sessions/[context]/messages": "sent from foldrun code (/send) or a script (foldrun sessions send); the dashboard has no conversation to send from",
  "POST /v1/billing/partner/plans/offer": CALLBACK + "foldrun.ir's signed storefront calls (coding plans); people buy at foldrun.ir",
  "POST /v1/billing/partner/signups": CALLBACK + "foldrun.ir's signed storefront calls (a sign-up link for a customer with no account); the person opens the account on /signup",
  "POST /v1/billing/partner/plans": CALLBACK + "foldrun.ir's signed storefront calls (coding plans); people buy at foldrun.ir",
  "POST /v1/billing/coding-plan": SEEN("billing/plans/coding-plan.tsx passes the method in"),
  "PATCH /v1/billing/coding-plan": SEEN("billing/plans/coding-plan.tsx passes the method in (the extra-usage switch)"),
  "DELETE /v1/billing/coding-plan": SEEN("billing/plans/coding-plan.tsx passes the method in"),
  "POST /v1/extract": "a file sent whole from the caller's own machine (the CLI's `foldrun text`, a script); the dashboard extracts a file already in storage — Storage → a file → Extract text (POST …/storage/extract, components/file-browser.tsx)",
  "POST /v1/workspaces/[workspace]/snapshots": "a folder from the caller's own machine, sent by the CLI or an AI app over MCP; a browser has no folder to send",
  "GET /v1/account/api": SERVER("settings/page.tsx → apiFactsFor"),
  "GET /v1/account/jobs": SERVER("settings pages → defaultsOf and the JOBS headings, read on the server"),
  "GET /v1/account/pause": SERVER("settings/page.tsx and layout.tsx → pauseView / adminState"),
  "GET /v1/workspaces/[workspace]/pause": SERVER("[workspace]/settings/page.tsx → pauseView"),
  "GET /v1/workspaces/[workspace]/evals/[evalName]/grades": SERVER("[workspace]/evals/page.tsx → readGrades / summariseGrades for each grader card"),
  "GET /v1/workspaces/[workspace]/proposals": SERVER("[workspace]/evals/page.tsx and inbox → listProposals + settleProposal"),
  "GET /v1/workspaces/[workspace]/proposals/[id]": SERVER("[workspace]/evals/page.tsx → listProposals, each settled as it is read"),
  "GET /v1/workspaces/[workspace]/runs/[runId]/files": SERVER("[workspace]/runs/[runId]/page.tsx → listRunOutputs, handed to live-run.tsx's Out column"),
  "GET /v1/workspaces/[workspace]/runs/[runId]/trace": SERVER("live-run.tsx → RunTree builds the same tree with core trace-tree.ts from the run it already polls"),
  "GET /v1/insights": SERVER("observe/page.tsx → cachedAccountInsights"),
  "GET /v1/observe": SERVER("observe/page.tsx → accountObservation"),
  "GET /v1/workspaces/[workspace]/evals/trends": SERVER("[workspace]/observe/page.tsx → evalTrends, the Evals by change table"),
  "GET /v1/issues": SERVER("issues/page.tsx, page.tsx and [workspace]/page.tsx → accountIssues"),
  "GET /v1/issues/[id]": SERVER("issues/page.tsx → accountIssues (one card per issue, #id)"),
  "GET /v1/account/backups": SERVER("settings/backups/page.tsx → listBackups, backupPolicy"),
  "GET /v1/account/backups/requests": SERVER("settings/backups/page.tsx → listRestoreRequests"),
  "GET /v1/account/flags": SERVER("settings/page.tsx → effectiveFlags"),
  "GET /v1/account/beta": SERVER("settings/page.tsx → betaProgram + effectiveFlags (the Beta features card)"),
  "GET /v1/account/model": SERVER("settings/page.tsx and model-key.tsx → describeAccountModel"),
  "PUT /v1/account/model": SEEN("settings/model-key.tsx passes the method in"),
  "DELETE /v1/account/model": SEEN("settings/model-key.tsx passes the method in"),
  "GET /v1/account/providers": SERVER("settings/page.tsx → providersInUse, lastProviderCheck"),
  "GET /v1/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email; the run page approves through /runs/<id>/approve",
  "POST /v1/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email; the run page approves through /runs/<id>/approve",
  "POST /v1/auth/login": SEEN("app/(auth)/auth-form.tsx"),
  "POST /v1/auth/login/code/verify": SEEN("app/(auth)/auth-form.tsx"),
  "POST /v1/auth/signup": SEEN("app/(auth)/auth-form.tsx"),
  "GET /v1/auth/verify": CALLBACK + "the link in a confirmation email",
  "GET /v1/avatars/[kind]/[id]": SEEN("avatarUrl() as an <img> src"),
  "GET /v1/billing": SERVER("billing pages → walletSummary, readLedger"),
  // FOL-94: no caller is credited here any more — it answers 404 to all; the
  // platform's operator credits through the operator console's adjustment.
  "POST /v1/billing": "answers 404 to every caller: credit by hand is the platform console's capped adjustment",
  "GET /v1/billing/details": SERVER("billing/details/page.tsx → billingDetails"),
  "GET /v1/billing/invoices": SERVER("billing/invoices/page.tsx → listInvoices, receiptUrlFor (server/billing-invoices.ts)"),
  "GET /v1/billing/plans": SERVER("billing/plans/page.tsx → PLANS"),
  "POST /v1/billing/stripe": CALLBACK + "Stripe's signed webhook",
  "GET /v1/billing/partner/topups/rate": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/quote": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "GET /v1/billing/partner/topups": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "GET /v1/billing/partner/topups/[id]": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/authority": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/paid": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/partner/topups/[id]/failed": CALLBACK + "foldrun.ir's signed storefront calls (Toman top-ups); people pay at foldrun.ir, linked from Billing",
  "POST /v1/billing/subscribe": SEEN("billing/plans/choose.tsx passes the method in"),
  "DELETE /v1/billing/subscribe": SEEN("billing/plans/choose.tsx passes the method in"),
  "GET /v1/changelog": SERVER("whats-new/page.tsx → releases, apiChangelog"),
  "POST /v1/cli/login": "the CLI's half of `foldrun login`",
  "GET /v1/cli/login/[id]": "the CLI's half of `foldrun login`",
  "POST /v1/events/[tenant]/[workspace]/[runId]": CALLBACK + "a run's event URL, for `wait: event`",
  "GET /v1/healthz": "for monitors and load balancers",
  "GET /v1/metrics": CALLBACK + "a Prometheus scrape",
  "GET /v1/status/history": "the public status page's, served with CORS",
  "GET /v1/signup": SERVER("(auth)/signup/page.tsx → signupModesNow, the same resolver (server/signup.ts); the route is the public site's, served with CORS"),
  "POST /v1/hooks/[tenant]/[workspace]/[flow]": CALLBACK + "a flow's webhook URL",
  "POST /v1/inbox/[tenant]/[workspace]/[flow]": CALLBACK + "inbound mail for a flow",
  "GET /v1/keys": SERVER("settings/page.tsx → listApiKeys"),
  "POST /v1/library/[kind]": SEEN("components/create.tsx (New in the library)"),
  "GET /v1/library/gallery": SERVER("library/page.tsx → galleryDrift"),
  "GET /v1/me": "who the caller is — the dashboard has the session itself",
  "GET /v1/mcp/connections": SERVER("settings/page.tsx → listGrants, the Connected AI apps list"),
  "POST /v1/mcp/oauth/register": CALLBACK + "an AI app registering itself for OAuth (RFC 7591)",
  "POST /v1/mcp/oauth/token": CALLBACK + "an AI app trading its code or refresh token for tokens",
  "POST /v1/mcp/oauth/revoke": CALLBACK + "an AI app handing back its own token (RFC 7009); people end a connection with DELETE /v1/mcp/connections/[id]",
  "POST /v1/mcp": "an MCP client's endpoint (Claude, Cursor, Codex), opened by a key and never a session; Settings → API keys shows how to connect one",
  "GET /v1/me/onboarding": SERVER("dashboard/page.tsx → onboardingFor"),
  "GET /v1/oauth/callback": CALLBACK + "an OAuth provider's redirect",
  "GET /v1/oauth/clients": SERVER("settings/page.tsx → listOAuthClients"),
  "GET /v1/oauth/connections": SERVER("settings pages → connectionStatus"),
  "GET /v1/schedule": SERVER("dashboard/page.tsx and settings → upcoming"),
  "GET /v1/secrets": SERVER("settings pages → listSecrets, secretHealth"),
  "GET /v1/team": SERVER("settings/page.tsx → listMembers"),
  "GET /v1/team/invites": SERVER("settings/page.tsx → listInvites"),
  "GET /v1/account/usage": SERVER("usage/page.tsx → accountUsage"),
  "GET /v1/account/usage/rates": SERVER("usage/page.tsx (Rates tab) → billing().meterRates and catalogue, the functions the route calls"),
  "GET /v1/pricing": SERVER("usage/page.tsx (Rates tab) → billing().catalogue; the route is foldrun.io and foldrun.ir's, served with CORS"),
  "GET /v1/account/usage/history": SERVER("usage/page.tsx → spendHistory"),
  "GET /v1/account/usage/budget": SERVER("limits/page.tsx → accountBudgetStanding, workspaceBudgetStanding"),
  "DELETE /v1/workspaces/[workspace]": SEEN("[workspace]/settings/page.tsx (Delete workspace)"),
  "GET /v1/customers": SERVER("settings/page.tsx (API keys → Customers) → customerLimits, listBlocked"),
  "GET /v1/customers/usage": SERVER("settings/page.tsx (API keys → Customers) → spendByCustomer"),
  "GET /v1/workspaces/[workspace]/agents": SERVER("[workspace] pages → listAgents"),
  "POST /v1/workspaces/[workspace]/assets": SEEN("components/create.tsx (New asset)"),
  "POST /v1/workspaces/[workspace]/deploy": "the dashboard writes one file at a time through /source and takes packages through /import",
  "POST /v1/workspaces/[workspace]/evals": SEEN("components/create.tsx (New eval)"),
  "GET /v1/workspaces/[workspace]/flows": SERVER("[workspace] pages → listFlows"),
  "POST /v1/workspaces/[workspace]/flows": SEEN("components/create.tsx (New flow)"),
  "PATCH /v1/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable",
  "DELETE /v1/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable",
  "GET /v1/workspaces/[workspace]/hooks/[flow]": SERVER("[workspace]/settings/page.tsx → webhookPath"),
  "GET /v1/workspaces/[workspace]/runs": SERVER("[workspace]/runs/page.tsx → listRuns"),
  "GET /v1/workspaces/[workspace]/runtimes": SERVER("[workspace]/page.tsx → workspaceRuntimeReport"),
  "GET /v1/workspaces/[workspace]/shares": SERVER("[workspace]/storage → server/storage-browser.ts listShares"),
  "DELETE /v1/workspaces/[workspace]/storage": SEEN("components/file-browser.tsx (Delete)"),
  "GET /v1/workspaces/[workspace]/storage/preview": SEEN("components/file-browser.tsx (Preview)"),
  "GET /s/[token]": CALLBACK + "a share link, opened by whoever has it",
  "HEAD /s/[token]": CALLBACK + "a share link, opened by whoever has it",
};

const ops: string[] = operations();

test("every API operation is reached by the CLI, or listed with why not", (t) => {
  const reach = cliReach();
  if (!reach) return t.skip("no ../foldrun-cli beside this checkout");
  const missing = ops.filter((o) => !reach.byOp.has(o) && !(o in NOT_IN_CLI));
  assert.deepEqual(missing, [], "add a CLI verb (with --help, a docs/cli.md row and a test), or list the operation in NOT_IN_CLI with the reason");
  // Billing's routes are absent from a checkout without billing, not gone.
  const stale = Object.keys(NOT_IN_CLI).filter((o) => (billingPresent || !isBillingRoute(o)) && (!ops.includes(o) || reach.byOp.has(o)));
  assert.deepEqual(stale, [], "these are listed as not in the CLI but are gone or now called — take them out of NOT_IN_CLI");
});

test("every API operation is reached by the dashboard, or listed with why not", () => {
  const reach = dashboardReach();
  const missing = ops.filter((o) => !reach.byOp.has(o) && !(o in NOT_IN_DASHBOARD));
  assert.deepEqual(missing, [], "add the page or control, or list the operation in NOT_IN_DASHBOARD with the reason");
  const stale = Object.keys(NOT_IN_DASHBOARD).filter((o) => (billingPresent || !isBillingRoute(o)) && (!ops.includes(o) || reach.byOp.has(o)));
  assert.deepEqual(stale, [], "these are listed as not in the dashboard but are gone or now called — take them out of NOT_IN_DASHBOARD");
});

test("every exception gives a reason", () => {
  for (const [op, why] of [...Object.entries(NOT_IN_CLI), ...Object.entries(NOT_IN_DASHBOARD)]) {
    assert.match(op, /^(GET|POST|PUT|PATCH|DELETE|HEAD) \//, op);
    assert.ok(why.length > 20, `${op}: say why`);
  }
});
