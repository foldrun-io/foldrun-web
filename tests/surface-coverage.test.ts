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
  "POST /api/account/close": "closing an account is the owner's, in person, in Settings",
  "POST /api/oauth/handoff/[id]": "accepting a terminal-started connection is a signed-in person's, in the browser; the CLI opens the page (/api/oauth/start answers its URL)",
  ...Object.fromEntries(
    [
      "POST /api/auth/email", "POST /api/auth/forgot", "POST /api/auth/login", "POST /api/auth/logout",
      "POST /api/auth/mfa/disable", "POST /api/auth/mfa/enable", "POST /api/auth/mfa/setup", "POST /api/auth/mfa/verify",
      "POST /api/auth/name", "POST /api/auth/password", "POST /api/auth/reset", "GET /api/auth/session",
      "GET /api/auth/sessions", "DELETE /api/auth/sessions", "POST /api/auth/signup", "POST /api/auth/timezone",
      "GET /api/auth/verify", "POST /api/auth/verify/resend",
      "POST /api/team", "PATCH /api/team/members/[id]", "DELETE /api/team/members/[id]", "POST /api/team/transfer",
      "PATCH /api/me/onboarding",
    ].map((op) => [op, SESSION]),
  ),
  "GET /api/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "PUT /api/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "DELETE /api/avatars/[kind]/[id]": "a picture, shown and uploaded in the browser",
  "GET /api/cli/authorize": "the browser's half of `foldrun login`",
  "POST /api/cli/authorize": "the browser's half of `foldrun login`",
  "GET /api/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email (`foldrun approve` uses /runs/<id>/approve)",
  "POST /api/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email (`foldrun approve` uses /runs/<id>/approve)",
  "POST /api/events/[tenant]/[workspace]/[runId]": CALLBACK + "a run's event URL, for `wait: event`",
  "POST /api/hooks/[tenant]/[workspace]/[flow]": CALLBACK + "a flow's webhook URL (`foldrun flow hook` prints it)",
  "POST /api/inbox/[tenant]/[workspace]/[flow]": CALLBACK + "inbound mail for a flow",
  // FOL-94: `foldrun billing credit` is retired with it — it answers 404 to all.
  "POST /api/billing": "answers 404 to every caller: credit by hand is the platform console's capped adjustment",
  "GET /api/billing/confirm": CALLBACK + "Stripe Checkout's return",
  "POST /api/billing/stripe": CALLBACK + "Stripe's signed webhook",
  "POST /api/unsubscribe": CALLBACK + "the one-click unsubscribe in a mail",
  "GET /api/oauth/callback": CALLBACK + "an OAuth provider's redirect",
  "GET /api/metrics": CALLBACK + "a Prometheus scrape",
  "GET /s/[token]": CALLBACK + "a share link, opened by whoever has it",
  "HEAD /s/[token]": CALLBACK + "a share link, opened by whoever has it",
  // Reached, by a path the scanner cannot evaluate.
  "GET /api/workspaces/[workspace]/agents": "`foldrun agent ls --to`: remoteListCmd, `/api/workspaces/${ws}/${kind}`",
  "GET /api/workspaces/[workspace]/flows": "`foldrun flow ls --to`: remoteListCmd, `/api/workspaces/${ws}/${kind}`",
  "POST /api/workspaces/[workspace]/agents": "`foldrun agent new --platform`: platformScaffold, `/api/workspaces/${ws}/${kind}`",
  "POST /api/workspaces/[workspace]/flows": "`foldrun flow new --platform`: platformScaffold, `/api/workspaces/${ws}/${kind}`",
  "POST /api/workspaces/[workspace]/deploy": "`foldrun deploy`: the URL is built from the platform's origin",
  "POST /api/workspaces/[workspace]/flows/[flow]": "`foldrun flow add` makes the same edit through PATCH { edit }",
  "DELETE /api/workspaces/[workspace]/flows/[flow]": "`foldrun flow rm-step` makes the same edit through PATCH { edit }",
  "PATCH /api/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable; `flow set` reaches it as /flows/${flow}",
  "DELETE /api/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable; `flow rm` reaches it as /flows/${flow}",
};

const SERVER = (page: string) => `the page renders it on the server, from the function the route calls: ${page}`;
const SEEN = (where: string) => `reached by a call the scanner cannot evaluate: ${where}`;

/** Operations the dashboard does not call through /api, and why. */
const NOT_IN_DASHBOARD: Record<string, string> = {
  "GET /api/account/api": SERVER("settings/page.tsx → apiFactsFor"),
  "GET /api/account/jobs": SERVER("settings pages → defaultsOf and the JOBS headings, read on the server"),
  "GET /api/account/pause": SERVER("settings/page.tsx and layout.tsx → pauseView / adminState"),
  "GET /api/workspaces/[workspace]/pause": SERVER("[workspace]/settings/page.tsx → pauseView"),
  "GET /api/workspaces/[workspace]/evals/[evalName]/grades": SERVER("[workspace]/evals/page.tsx → readGrades / summariseGrades for each grader card"),
  "GET /api/workspaces/[workspace]/proposals": SERVER("[workspace]/evals/page.tsx and inbox → listProposals + settleProposal"),
  "GET /api/workspaces/[workspace]/proposals/[id]": SERVER("[workspace]/evals/page.tsx → listProposals, each settled as it is read"),
  "GET /api/workspaces/[workspace]/runs/[runId]/trace": SERVER("live-run.tsx → RunTree builds the same tree with core trace-tree.ts from the run it already polls"),
  "GET /api/insights": SERVER("observe/page.tsx → accountInsights"),
  "GET /api/issues": SERVER("issues/page.tsx, page.tsx and [workspace]/page.tsx → accountIssues"),
  "GET /api/issues/[id]": SERVER("issues/page.tsx → accountIssues (one card per issue, #id)"),
  "GET /api/account/backups": SERVER("settings/backups/page.tsx → listBackups, backupPolicy"),
  "GET /api/account/backups/requests": SERVER("settings/backups/page.tsx → listRestoreRequests"),
  "GET /api/account/flags": SERVER("settings/page.tsx → effectiveFlags"),
  "GET /api/account/model": SERVER("settings/page.tsx and model-key.tsx → describeAccountModel"),
  "PUT /api/account/model": SEEN("settings/model-key.tsx passes the method in"),
  "DELETE /api/account/model": SEEN("settings/model-key.tsx passes the method in"),
  "GET /api/account/providers": SERVER("settings/page.tsx → providersInUse, lastProviderCheck"),
  "GET /api/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email; the run page approves through /runs/<id>/approve",
  "POST /api/approve/[tenant]/[workspace]/[runId]": CALLBACK + "the signed approve link in an approval email; the run page approves through /runs/<id>/approve",
  "POST /api/auth/login": SEEN("components/auth-form.tsx"),
  "POST /api/auth/signup": SEEN("components/auth-form.tsx"),
  "GET /api/auth/verify": CALLBACK + "the link in a confirmation email",
  "GET /api/avatars/[kind]/[id]": SEEN("avatarUrl() as an <img> src"),
  "GET /api/billing": SERVER("billing pages → walletSummary, readLedger"),
  // FOL-94: no caller is credited here any more — it answers 404 to all; the
  // platform's operator credits through the operator console's adjustment.
  "POST /api/billing": "answers 404 to every caller: credit by hand is the platform console's capped adjustment",
  "GET /api/billing/details": SERVER("billing/details/page.tsx → billingDetails"),
  "GET /api/billing/plans": SERVER("billing/plans/page.tsx → PLANS"),
  "POST /api/billing/stripe": CALLBACK + "Stripe's signed webhook",
  "POST /api/billing/subscribe": SEEN("billing/plans/choose.tsx passes the method in"),
  "DELETE /api/billing/subscribe": SEEN("billing/plans/choose.tsx passes the method in"),
  "GET /api/changelog": SERVER("whats-new/page.tsx → releases, apiChangelog"),
  "POST /api/cli/login": "the CLI's half of `foldrun login`",
  "GET /api/cli/login/[id]": "the CLI's half of `foldrun login`",
  "POST /api/events/[tenant]/[workspace]/[runId]": CALLBACK + "a run's event URL, for `wait: event`",
  "GET /api/healthz": "for monitors and load balancers",
  "GET /api/metrics": CALLBACK + "a Prometheus scrape",
  "GET /api/status/history": "the public status page's, served with CORS",
  "POST /api/hooks/[tenant]/[workspace]/[flow]": CALLBACK + "a flow's webhook URL",
  "POST /api/inbox/[tenant]/[workspace]/[flow]": CALLBACK + "inbound mail for a flow",
  "GET /api/keys": SERVER("settings/page.tsx → listApiKeys"),
  "POST /api/library/[kind]": SEEN("components/create.tsx (New in the library)"),
  "GET /api/library/gallery": SERVER("library/page.tsx → galleryDrift"),
  "GET /api/me": "who the caller is — the dashboard has the session itself",
  "GET /api/me/onboarding": SERVER("dashboard/page.tsx → onboardingFor"),
  "GET /api/oauth/callback": CALLBACK + "an OAuth provider's redirect",
  "GET /api/oauth/clients": SERVER("settings/page.tsx → listOAuthClients"),
  "GET /api/oauth/connections": SERVER("settings pages → connectionStatus"),
  "GET /api/schedule": SERVER("dashboard/page.tsx and settings → upcoming"),
  "GET /api/secrets": SERVER("settings pages → listSecrets, secretHealth"),
  "GET /api/team": SERVER("settings/page.tsx → listMembers"),
  "GET /api/team/invites": SERVER("settings/page.tsx → listInvites"),
  "GET /api/usage": SERVER("usage/page.tsx → accountUsage"),
  "GET /api/usage/history": SERVER("usage/page.tsx → spendHistory"),
  "DELETE /api/workspaces/[workspace]": SEEN("[workspace]/settings/page.tsx (Delete workspace)"),
  "GET /api/workspaces/[workspace]/agents": SERVER("[workspace] pages → listAgents"),
  "POST /api/workspaces/[workspace]/assets": SEEN("components/create.tsx (New asset)"),
  "POST /api/workspaces/[workspace]/deploy": "the dashboard writes one file at a time through /source and takes packages through /import",
  "POST /api/workspaces/[workspace]/evals": SEEN("components/create.tsx (New eval)"),
  "GET /api/workspaces/[workspace]/flows": SERVER("[workspace] pages → listFlows"),
  "POST /api/workspaces/[workspace]/flows": SEEN("components/create.tsx (New flow)"),
  "DELETE /api/workspaces/[workspace]/flows/[flow]": SEEN("components/flow-board.tsx (remove a step)"),
  "PATCH /api/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable",
  "DELETE /api/workspaces/[workspace]/flows/draft": "an alias so a flow named draft stays editable",
  "GET /api/workspaces/[workspace]/hooks/[flow]": SERVER("[workspace]/settings/page.tsx → webhookPath"),
  "GET /api/workspaces/[workspace]/runs": SERVER("[workspace]/runs/page.tsx → listRuns"),
  "GET /api/workspaces/[workspace]/runtimes": SERVER("[workspace]/page.tsx → workspaceRuntimeReport"),
  "GET /api/workspaces/[workspace]/shares": SERVER("[workspace]/storage → server/storage-browser.ts listShares"),
  "GET /api/workspaces/[workspace]/storage": SERVER("[workspace]/storage/page.tsx → listStorage"),
  "DELETE /api/workspaces/[workspace]/storage": SEEN("components/file-browser.tsx (Delete)"),
  "GET /api/workspaces/[workspace]/storage/download": SEEN("components/file-browser.tsx (Download link)"),
  "GET /api/workspaces/[workspace]/storage/preview": SEEN("components/file-browser.tsx (Preview)"),
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
