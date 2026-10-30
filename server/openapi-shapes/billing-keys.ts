// OpenAPI request/response schemas: /api/billing*, /api/keys*, /api/secrets*, /api/oauth/*, /api/library/*, /api/identity.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Schema, type Shape, obj, str, bool, int, arr, nullable, OK } from "./kit.ts";

const num = { type: "number" };

/** Who the invoices are made out to — platform billing-details.ts. */
const BillingAddress = obj(
  {
    line1: str(), line2: str(), city: str(), state: str(), postcode: str(),
    country: str("ISO 3166-1 alpha-2, upper case: AU"),
  },
  ["line1", "country"],
);
const BillingDetails = obj(
  {
    legalName: str("who the invoice is made out to"),
    email: str("where Stripe sends invoices and receipts"),
    abn: str("an Australian Business Number, 11 digits, stored without spaces"),
    address: BillingAddress,
    updatedAt: str(),
    updatedBy: str(),
  },
  ["legalName"],
);

/** One plan of the catalogue — platform plans.ts. */
const Plan = obj({
  id: str("starter | creator | pro | scale"), name: str(),
  monthlyUsd: { ...num, description: "the monthly fee, USD" },
  credits: { ...int, description: "credits the fee buys each cycle" },
  creditUsd: { ...num, description: "what one extra credit costs on this plan, USD" },
  concurrency: { ...int, description: "runs driven at once" },
  workspaces: { type: ["integer", "null"], description: "workspaces the account may create; null is unlimited" },
  priority: str("normal | high — the queue lane"),
  vcpu: num, memGiB: num, diskGiB: num,
  stepVcpu: { ...num, description: "the most one step may hold" }, stepMemGiB: num, stepDiskGiB: num,
  pitch: str(),
});

const AutoTopUp = obj(
  {
    enabled: bool,
    thresholdUsd: { ...num, description: "refill when the balance falls below this; above 0" },
    amountUsd: { ...num, description: "what one refill charges, 5–500" },
  },
  ["thresholdUsd", "amountUsd"],
);

const Waived = arr(str("models | compute | network"));

/** A ledger line as an account sees it: never `cost` (the platform's
 *  provider bill — the margin is derivable from it). */
const ledgerLine = (extra: Record<string, Schema> = {}): Schema => ({
  ...obj({
    t: str("when, ISO"),
    kind: str("topup | run | adjustment | grant | expire"),
    usd: { ...num, description: "positive credits the account, negative spends it; for a run, the charge" },
    meter: obj({ steps: int, computeSecs: num, netBytes: int }),
    split: { ...obj({ modelUsd: num, computeUsd: num, networkUsd: num }), description: "the charge in its parts; they sum to -usd. Absent on older lines" },
    carriedUsd: { ...num, description: "on a grant: the part that is last cycle's unused credit rolling over" },
    waived: Waived,
    workspace: str(), runId: str(), flow: str(), note: str(),
    key: str("the once-only handle: run:<id>, grant:<marker>, …"),
    reason: str("usage | pod | fee | checkout | auto-topup | manual | operator | refund | dispute | dispute-won | plan | trial | grant-expired | credits-expired"),
    pricingVersion: int,
    ...extra,
  }),
  additionalProperties: true,
});

const OAuthClientConfig = obj(
  {
    authorize_url: str("https"),
    token_url: str(),
    client_id: str(),
    client_secret: str("write-only, never returned; empty for a public app, which then needs PKCE"),
    scopes: str("the default scopes, space-separated"),
    authorize_extra: { type: "object", additionalProperties: { type: "string" }, description: "extra authorize-URL params (Google: access_type=offline, prompt=consent)" },
    pkce: { ...bool, description: "S256 PKCE, on unless false" },
    issuer: str("the authorization server's issuer; the callback's iss must equal it"),
  },
  ["authorize_url", "token_url", "client_id"],
);

/** What starting a consent answers: the provider's authorize URL for a
 *  browser, or the hand-off page a signed-in person accepts first for a key. */
const ConsentStart = obj(
  {
    ok: bool,
    url: str("the provider's authorize URL (a browser session), or the dashboard's hand-off page /dashboard/connect/<id> (an API key)"),
    handoff: { ...bool, description: "true when url is the hand-off page" },
  },
  ["ok", "url"],
);

const libraryKind = "tools | hooks | knowledge | memory | skills | scripts";

export const SHAPES: Record<string, Shape> = {
  "POST /api/billing": {
    noBody: "refused with 404 for every caller since FOL-94 (28 Oct 2026): credit comes from a payment (POST /api/billing/checkout) or the platform team",
    noResponse: "always the 404 error answer",
  },
  "POST /api/billing/card": {
    noBody: "starts a Stripe Checkout in setup mode for the account's own customer; nothing to choose",
    response: obj({ ok: bool, url: str("Stripe's page that collects the card; it returns to /api/billing/confirm") }, ["ok", "url"]),
  },
  "GET /api/billing/confirm": {
    query: [{ name: "session_id", description: "the Stripe Checkout session Stripe returns with; everything about it is read from Stripe" }],
    status: "307",
    media: {
      type: "text/plain",
      description:
        "A redirect (307) to the dashboard: /dashboard/wallet?topup=success&usd=…|pending|unknown, ?card=saved|unconfirmed, or /dashboard/billing/plans?plan=<id>&started=1|pending|unknown",
    },
  },
  "GET /api/billing/details": {
    response: obj({
      details: nullable(BillingDetails),
      stripe: { ...bool, description: "card payments are configured on this install" },
      customer: { ...bool, description: "the account has a Stripe customer" },
      tax: { ...bool, description: "Stripe Tax works GST out from the address" },
    }),
  },
  "PUT /api/billing/details": {
    body: obj(
      {
        legalName: str("required, at most 200 characters"),
        email: str(),
        abn: str("11 digits passing the ABR check; spaces are dropped"),
        address: { ...obj({ line1: str("required once any of the address is given"), line2: str(), city: str(), state: str(), postcode: str(), country: str("two letters, e.g. AU") }), description: "all empty or absent: no address" },
      },
      ["legalName"],
    ),
    response: obj(
      {
        ok: bool,
        details: BillingDetails,
        synced: { ...bool, description: "Stripe now has them; false without Stripe or when it refused — kept here and sent on the next save or checkout" },
        syncError: str("Stripe's words, when it refused"),
      },
      ["ok", "details", "synced"],
    ),
  },
  "GET /api/billing/plans": {
    response: obj({
      creditUsd: { ...num, description: "what one credit is, USD (0.01)" },
      trialCredits: int,
      plans: arr(Plan),
      cards: { ...bool, description: "card payments are configured on this install" },
      current: {
        ...obj({
          plan: { type: ["string", "null"] },
          status: { type: ["string", "null"], description: "active | past_due | cancelled" },
          cycleCredits: int, cycleRemainingCredits: int, cycleSpentCredits: int,
          resetsAt: { type: ["string", "null"] },
        }),
        type: ["object", "null"],
        description: "null with no plan and no live grant",
      },
      balanceUsd: num,
      balanceCredits: int,
      overdraft: { ...obj({ limitUsd: { type: ["number", "null"] } }), type: ["object", "null"], description: "the platform's allowance to run past zero, when there is one" },
    }),
  },
  "GET /api/billing/statement": {
    query: [
      { name: "month", description: "YYYY-MM; default this month" },
      { name: "format", description: "csv answers text/csv (an attachment: date, kind, description, workspace, flow, run, amount_usd, models_usd, platform_usd, reference, reason); otherwise JSON" },
    ],
    response: obj({
      month: str(),
      spentUsd: { ...num, description: "usage and fees" },
      addedUsd: num,
      removedUsd: { ...num, description: "expiries, refunds, chargebacks — taken off but not spent" },
      rows: arr(ledgerLine({ label: str("the line's description") })),
    }),
  },
  "POST /api/billing/stripe": {
    body: {
      ...obj({ id: str(), type: str(), created: int, data: obj({ object: { type: "object", additionalProperties: true } }) }),
      additionalProperties: true,
      description: "a Stripe event, signed in the Stripe-Signature header over the raw body",
    },
    response: obj({ ok: bool, status: str("ok | skipped | ignored"), outcome: str() }),
  },
  "DELETE /api/billing/subscribe": {
    noBody: "cancels the account's one subscription at the end of its cycle",
    response: obj({ ok: bool, endsAt: { type: ["string", "null"], description: "when the cycle, and the plan, end" } }),
  },
  "GET /api/billing/wallet": {
    response: obj({
      enabled: { ...bool, description: "billing is on" },
      stripe: { ...bool, description: "card payments are configured on this install" },
      summary: obj({
        balanceUsd: num,
        burnPerDayUsd: { ...num, description: "average spend per day over the days with data, up to 30" },
        spend7dUsd: num, spend30dUsd: num,
        daysLeft: { type: ["number", "null"], description: "until empty at this burn; null when nothing is burning" },
        emptyOn: { type: ["string", "null"], description: "ISO date the balance hits zero at this burn" },
        warnBelowUsd: num,
        daily: arr(obj({ day: str(), usd: num }), "the last thirty days, oldest first"),
        monthToDateUsd: num,
        suggestedTopUpUsd: { type: ["number", "null"], description: "about a month at this burn; null when nothing is burning" },
        overdraft: { ...obj({ limitUsd: { type: ["number", "null"] } }), type: ["object", "null"] },
        waived: Waived,
      }),
      cardSaved: bool,
      autoTopUp: nullable(AutoTopUp),
      email: { type: ["string", "null"], description: "where low-balance warnings go" },
      dunning: obj({
        status: str("none | grace | suspended — an unpaid plan invoice: runs still start in grace, not once suspended"),
        invoices: arr(str()), failedAt: str(), graceUntil: str(), suspendedAt: str(),
        payUrl: str("Stripe's page for paying the newest failed invoice"),
        amountDue: { ...int, description: "in the currency's minor unit" },
        currency: str(),
      }, ["status"]),
    }),
  },
  "PUT /api/billing/wallet": {
    body: obj({
      autoTopUp: { ...AutoTopUp, type: ["object", "null"], description: "null turns auto top-up off; omitted, unchanged" },
      email: { type: ["string", "null"], description: "where low-balance warnings go; null or empty clears it; omitted, unchanged" },
    }),
    response: OK,
  },
  "GET /api/identity": {
    query: [{ name: "workspace", description: "fill the workspace into the subject" }],
    response: obj({
      enabled: { ...bool, description: "keyless identities are on (FOLDRUN_OIDC_ISSUER is set)" },
      issuer: { type: ["string", "null"] },
      subject: str("account:<account>:workspace:<workspace>:agent:<agent> — pin at least the account"),
      tokenSeconds: int,
    }),
  },
  "POST /api/keys/{id}/rotate": {
    body: obj({
      grace: { type: ["string", "integer"], description: "how long the old key keeps working: 0 (default) or a duration up to 7d — 30m, 1h, 24h. A cli-login key rotating itself ignores it (10 minutes)" },
    }),
    response: obj(
      {
        ok: bool,
        key: str("the new key, shown once"),
        id: str(), prefix: str(), role: str(),
        workspaces: { type: ["array", "null"], items: str() },
        expiresAt: { type: ["string", "null"] },
        replaced: obj({ id: str("the key this one replaces"), endsAt: str("when the old key stops working") }),
      },
      ["ok", "key", "id"],
    ),
  },
  "GET /api/library/{kind}": {
    query: [{ name: "path", description: "one file, relative to the kind's folder; omitted, the list" }],
    response: obj({
      kind: str(`the list: ${libraryKind}`),
      entries: arr(obj({
        path: str("relative to the kind's folder"), name: str(), description: str(),
        hasScripts: { ...bool, description: "a skill whose folder bundles scripts/" },
        files: arr(str(), "every file of a folder entry, path included; absent for a single file"),
        transport: str("tools: http | script | mcp"),
        runs: str("a script tool: the file it runs"),
        updatedAt: str(),
      }), "with no ?path"),
      path: str("with ?path"),
      content: str("with ?path: the file's text"),
    }),
  },
  "POST /api/library/{kind}": {
    body: obj(
      {
        name: str("kebab-case"),
        template: str("start from: a gallery entry, or for tools a transport (http | script | mcp); unknown falls back to blank"),
        language: str("a script tool's language: javascript | python | bash"),
      },
      ["name"],
    ),
    response: obj({ ok: bool, path: str("the first file written, relative to the kind's folder") }),
  },
  "PUT /api/library/{kind}": {
    body: obj({ path: str("relative to the kind's folder"), content: str() }, ["path", "content"]),
    response: obj({ ok: bool, path: str() }),
  },
  "DELETE /api/library/{kind}": {
    body: obj({ path: str("a file or folder, relative to the kind's folder") }, ["path"]),
    response: OK,
  },
  "GET /api/library/gallery": {
    response: obj({
      tools: arr(obj({
        name: str(),
        kind: str("scripts | tools — the library shelf it installs onto"),
        title: str(), description: str(),
        files: arr(obj({ kind: str("scripts | tools"), file: str(), content: str() }), "definition and program, whole"),
        installed: { type: ["string", "null"], description: "current | differs — this account's copy; null when not installed (always null for a script)" },
      })),
    }),
  },
  "POST /api/library/gallery": {
    body: obj({ tool: str("a gallery tool's name") }, ["tool"]),
    response: obj({ ok: bool, path: str() }),
  },
  "GET /api/oauth/callback": {
    query: [
      { name: "code", description: "from the provider" },
      { name: "state", description: "the single-use nonce the start made" },
      { name: "iss", description: "the provider's issuer (RFC 9207), checked when sent" },
      { name: "error", description: "the provider refused" },
      { name: "error_description", description: "shown only to the browser that started the consent" },
    ],
    status: "307",
    media: {
      type: "text/plain",
      description: "A redirect (307) to /dashboard/settings with ?connected=<secret>[&connected_static=1], or ?connect_error=<why>",
    },
  },
  "GET /api/oauth/clients": {
    response: obj({
      clients: arr(obj({
        name: str(), authorize_url: str(), token_url: str(), client_id: str(), scopes: str(),
        authorize_extra: { type: "object", additionalProperties: { type: "string" } },
        pkce: bool, issuer: str(), createdAt: str(),
      }), "metadata only — the client_secret never comes back"),
    }),
  },
  "POST /api/oauth/clients": {
    body: obj({ name: str("kebab-case, e.g. google-ads"), config: OAuthClientConfig }, ["name", "config"]),
    response: obj({ ok: bool, name: str() }),
  },
  "DELETE /api/oauth/clients": {
    body: obj({ client: str("a saved client's name") }, ["client"]),
    response: OK,
  },
  "GET /api/oauth/connections": {
    response: obj({
      connections: arr(obj({
        name: str("the secret"),
        workspace: str("absent for the account's own"),
        client: { type: ["string", "null"], description: "the saved client a reconnect runs" },
        scopes: str(), connectedAt: str(), refreshExpiresAt: str(),
        lastError: str(), lastErrorAt: str(), notifiedAt: str(), lastOkAt: str(),
        linkOnly: bool,
        status: str("ok | expiring | expired | failed | no-client"),
        daysLeft: { type: ["integer", "null"] },
        reconnectUrl: str("the settings page opened on this secret"),
      })),
    }),
  },
  "POST /api/oauth/handoff/{id}": {
    noBody: "the hand-off in the path names the client, secret, workspace and scopes; a signed-in person accepts it",
    response: obj({ ok: bool, url: str("the provider's authorize URL, bound to this browser") }, ["ok", "url"]),
  },
  "POST /api/oauth/reconnect": {
    body: obj(
      {
        secret: str("the oauth2 secret to connect again"),
        workspace: str("its workspace; omitted, the account's"),
        provider: str("a saved client's name (or its prefix) for a secret that has none of its own"),
        scopes: str("space-separated, at most 2000 characters; omitted, the scopes it was connected with, else the client's default"),
      },
      ["secret"],
    ),
    response: {
      ...ConsentStart,
      properties: {
        ...(ConsentStart.properties as Record<string, Schema>),
        client: str("the saved client it runs"),
        redirectUri: str("the callback the consent returns to"),
        scopes: str("the scopes asked for, when known"),
      },
    },
  },
  "POST /api/oauth/start": {
    body: obj(
      {
        client: str("a saved OAuth client's name"),
        secret: str("the secret the result becomes"),
        workspace: str("omitted, the account's"),
        scopes: str("space-separated, instead of the client's default; at most 2000 characters"),
      },
      ["client", "secret"],
    ),
    response: ConsentStart,
  },
};
