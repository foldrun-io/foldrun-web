// OpenAPI request/response schemas: /v1/auth/*, /v1/cli/*, /v1/me*, /v1/team*, /v1/unsubscribe, /v1/support/*, /v1/avatars/*.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Shape, type Schema, obj, str, bool, int, arr, OK, Notice } from "./kit.ts";

const nstr = (description?: string): Schema => ({ type: ["string", "null"], ...(description ? { description } : {}) });

/** Where a sign-in lands: the account, and its first workspace. */
const SignedIn = {
  tenant: str("the account signed in to"),
  workspace: nstr("the account's first workspace, where the dashboard opens; null when it has none"),
};

/** One live session, as server/sessions.ts listSessions keeps it. */
const SessionRow = obj({
  id: str(),
  userId: str(),
  tenant: str(),
  createdAt: str(),
  lastSeenAt: str(),
  expiresAt: str(),
  userAgent: nstr("the browser that signed in, as it said; null when it said nothing"),
  method: str("how the person signed in: password or email-code (a session from before it was recorded reads as password)"),
  isCurrent: { ...bool, description: "the session making this request" },
});

/** One mail category and this person's choice (platform email-preferences preferenceSummary). */
const MailPreferences = obj({
  email: str("the person these choices are for"),
  categories: arr(
    obj({
      category: str("the category's id, e.g. security | invites | billing | account | run-alerts …"),
      label: str(),
      description: str(),
      required: { ...bool, description: "always sent; cannot be turned off" },
      why: str("for a required category: why it cannot be turned off"),
      perWorkspace: { ...bool, description: "it can be turned off for one workspace alone" },
      enabled: { ...bool, description: "account-wide; always true for a required category" },
      workspaces: { type: "object", additionalProperties: { type: "boolean" }, description: "workspace → on/off where it differs from the account-wide choice; empty unless perWorkspace" },
    }),
  ),
});

const OnboardingStep = obj({
  id: str("model | workspace | agent | run | success | secret | trigger | teammate | billing | cli"),
  title: str(),
  why: str(),
  href: str("where to do it, a dashboard path"),
  cli: str("the CLI's way to do it, when there is one"),
  done: bool,
  hidden: { ...bool, description: "this person hid the step from their card; always false for a key" },
});

/** A workspace's checklist (workspace-checklist-model.ts). */
const ChecklistItem = obj({
  id: str("run | trigger | owner | eval | notify"),
  title: str(),
  why: str(),
  href: str("where it is done, a dashboard path"),
  done: bool,
  hidden: { ...bool, description: "this person hid the item" },
});
const WorkspaceChecklist = obj({
  workspace: str(),
  items: arr(ChecklistItem),
  done: int,
  total: int,
  complete: { ...bool, description: "every item done" },
  dismissed: { ...bool, description: "this person hid the checklist for this workspace" },
  show: { ...bool, description: "whether the card is drawn: not dismissed, and an item is neither done nor hidden" },
});
const ChecklistPatch = obj(
  {
    workspace: str("the workspace whose checklist this changes"),
    dismissed: { ...bool, description: "true hides the whole checklist for you; false brings it back" },
    hide: arr(str(), "item ids to hide for you"),
    show: arr(str(), "item ids to bring back"),
  },
  ["workspace"],
);

const RunView = obj({ name: str("1 to 40 characters, unique"), query: str("a query string of the runs pages' filters, e.g. tool=web&tool_error=1") }, ["name", "query"]);
const Preferences = obj({
  theme: str("system | light | dark — system (the default) follows the computer"),
  runViews: arr(RunView, "saved run searches, at most 20"),
});

const Member = obj({
  id: str(),
  email: str(),
  createdAt: str(),
  owner: { ...bool, description: "holds the account; there is exactly one" },
  role: str("owner | admin | editor | viewer"),
  workspaces: { type: ["array", "null"], items: str(), description: "the workspaces they may open; null for all. To a caller scoped to some workspaces, only the ones it may open too" },
});

export const SHAPES: Record<string, Shape> = {
  "POST /v1/auth/email": {
    body: obj(
      {
        password: str("your current password"),
        email: str("the new address"),
      },
      ["password", "email"],
    ),
    response: obj({
      ok: bool,
      from: str("the address the login has now"),
      to: str("the address asked for"),
      pending: { ...bool, description: "always true: nothing moved yet — the new address was mailed a link that makes the move (an install that sends no mail refuses with 409, code mail_not_configured)" },
      verificationSent: { ...bool, description: "the mail to the new address went out" },
      otherSessionsEnded: { ...int, description: "always 0: other sessions end at the click, not now" },
    }),
  },
  "POST /v1/auth/forgot": {
    body: obj({ email: str() }, ["email"]),
    response: obj({ ok: bool, message: str("always the same sentence, whatever the address") }),
  },
  "POST /v1/auth/login": {
    body: obj({ email: str(), password: str() }, ["email", "password"]),
    response: obj({
      ok: bool,
      mfa: { ...bool, description: "true: a second factor is on — no session yet; send challenge and a code to POST /v1/auth/mfa/verify" },
      challenge: str("with mfa: the five-minute token POST /v1/auth/mfa/verify takes"),
      ...SignedIn,
    }, ["ok"]),
  },
  "POST /v1/auth/login/code": {
    body: obj({ email: str() }, ["email"]),
    response: obj({ ok: bool }, ["ok"]),
  },
  "POST /v1/auth/login/code/verify": {
    body: obj({ email: str(), code: str("the six digits from the mail, from the browser that asked for them") }, ["email", "code"]),
    response: obj({
      ok: bool,
      mfa: { ...bool, description: "true: a second factor is on — no session yet; send challenge and a code to POST /v1/auth/mfa/verify" },
      challenge: str("with mfa: the five-minute token POST /v1/auth/mfa/verify takes"),
      ...SignedIn,
    }, ["ok"]),
  },
  "POST /v1/auth/logout": {
    noBody: "the session cookie says which session ends; nothing else is read",
    response: OK,
  },
  "POST /v1/auth/mfa/disable": {
    body: obj({ password: str(), code: str("six digits from the app, or one backup code") }, ["password", "code"]),
    response: OK,
  },
  "POST /v1/auth/mfa/enable": {
    body: obj({ enrol: str("the enrol token POST /v1/auth/mfa/setup answered"), code: str("six digits from the app") }, ["enrol", "code"]),
    response: obj({
      ok: bool,
      backup: arr(str(), "eight backup codes, shown exactly once"),
      otherSessionsEnded: { ...int, description: "the person's other sessions ended now; this browser keeps its own" },
    }),
  },
  "POST /v1/auth/mfa/setup": {
    noBody: "the signed-in person is the one enrolling; a fresh secret is drawn here",
    response: obj({
      secret: str("the TOTP secret, base32, for typing into an app by hand"),
      uri: str("the otpauth:// URI an app scans"),
      qr: str("a data: URL of a PNG QR code of uri"),
      enrol: str("a token carrying the sealed secret to POST /v1/auth/mfa/enable — nothing is stored until then"),
    }),
  },
  "POST /v1/auth/mfa/verify": {
    body: obj(
      {
        challenge: str("the token POST /v1/auth/login answered with mfa: true"),
        code: str("six digits from the app, or one backup code"),
      },
      ["challenge", "code"],
    ),
    response: obj({
      ok: bool,
      ...SignedIn,
      backupUsed: { ...bool, description: "present (true) when a backup code signed in; it is spent" },
    }),
  },
  "POST /v1/auth/name": {
    body: obj({
      firstName: nstr("at most 80 characters; null or empty clears it"),
      lastName: nstr("at most 80 characters; null or empty clears it"),
    }),
    response: OK,
  },
  "POST /v1/auth/password": {
    body: obj({ current: str("your current password"), next: str("at least 10 characters, not your email, not in a known breach") }, ["current", "next"]),
    response: obj({
      ok: bool,
      otherSessionsEnded: { ...int, description: "other browsers signed out; this one stays" },
      message: str("what happened, in a sentence"),
    }),
  },
  "POST /v1/auth/reset": {
    body: obj({ token: str("from the reset link"), password: str("the new password") }, ["token", "password"]),
    response: obj({
      ok: bool,
      account: str(),
      signIn: { ...bool, description: "present (true) when a second factor is on: no session was made — sign in, and the login asks for the code" },
    }),
  },
  "GET /v1/auth/session": {
    response: obj({
      user: {
        ...obj({
          id: str(),
          email: str(),
          tenant: str(),
          role: str("owner | admin | editor | viewer"),
          avatar: nstr("the person's picture URL; null for none"),
          accountAvatar: nstr("the account's picture URL; null for none"),
          emailVerifiedAt: nstr(),
          mfaEnabled: bool,
          accounts: arr(obj({ tenant: str(), role: str("owner | admin | editor | viewer"), current: { ...bool, description: "the account this session is for" } }), "every account this login is in; a session is for one of them (POST moves it)"),
        }),
        type: ["object", "null"],
        description: "null when not signed in",
      },
      signupOpen: { ...bool, description: "there is a way in for a stranger to show: the install's first account, free sign-up, or paid sign-up in effect (GET /v1/signup says which, for the public)" },
      hasUsers: { ...bool, description: "the install has at least one account" },
    }),
  },
  "POST /v1/auth/session": {
    body: {
      oneOf: [
        obj({ account: str("move this session to another account you are in"), as: str("the user id the page showed as signed in; 412 when the browser is someone else now") }, ["account"]),
        obj({ invite: str("join the account this invite is for with the login you are signed in with, and move there"), as: str("the user id the page showed as signed in; 412 when the browser is someone else now") }, ["invite"]),
      ],
    },
    response: obj({ ok: bool, tenant: str("the account the new session is for") }, ["ok", "tenant"]),
  },
  "GET /v1/auth/sessions": {
    response: obj({
      revocable: { ...bool, description: "false: this install keeps no session rows, so it cannot list or end them (sessions is then empty)" },
      current: nstr("the id of the session making this request"),
      sessions: arr(SessionRow, "live sessions, most recently seen first"),
    }),
  },
  "DELETE /v1/auth/sessions": {
    body: obj({
      id: str("end this one session — never the one asking (use sign out)"),
      others: { ...bool, description: "true: end every session but the one asking; id is then ignored" },
    }),
    response: obj({ ok: { ...bool, description: "false when no live session of yours had that id" }, ended: int }),
  },
  "POST /v1/auth/signup": {
    body: obj(
      {
        email: str(),
        password: str("at least 10 characters, not your email, not in a known breach"),
        account: str("the new account's name; required unless invite is given (an invite decides the account)"),
        invite: str("the token from an invite link"),
        setup: str("the install's setup token (FOLDRUN_SETUP_TOKEN), for its first account"),
      },
      ["email", "password"],
    ),
    response: obj({ ok: bool, ...SignedIn, workspace: str("where the dashboard opens; a new account gets one called home") }),
  },
  "POST /v1/auth/timezone": {
    body: obj({ timezone: nstr("an IANA zone, e.g. Australia/Sydney; null goes back to the browser's") }, ["timezone"]),
    response: obj({ ok: bool, timezone: nstr() }),
  },
  "GET /v1/auth/verify": {
    query: [{ name: "token", description: "from a confirmation or email-change link mailed before 25 Nov 2026" }],
    status: "303",
    media: {
      type: "text/html",
      description: "A redirect (303) to /verify?token=…, the page that asks: opening a link changes nothing (FOL-319)",
    },
  },
  "POST /v1/auth/verify": {
    body: obj({ token: str("from the confirmation mail, or the email-change link mailed to the new address") }, ["token"]),
    status: "303",
    media: {
      type: "text/html",
      description: "A redirect (303): to /dashboard?verified=1 once the address is verified (and, for an email-change link, the login moved), else to /login?verify=invalid",
    },
  },
  "POST /v1/auth/verify/resend": {
    noBody: "the confirmation goes to the signed-in person's own address",
    response: obj({ ok: bool, already: { ...bool, description: "present (true) when the address is already verified; nothing is sent" } }),
  },
  "GET /v1/avatars/{kind}/{id}": {
    media: {
      type: "image/*",
      description: "the picture's bytes — image/png, image/jpeg or image/webp; cached for a year (a new picture has a new URL). kind is user | workspace | account",
    },
  },
  "PUT /v1/avatars/{kind}/{id}": {
    noBody: "the body is the image's raw bytes, not JSON — a PNG, JPEG or WebP of at most 1 MB, told apart by its bytes, not its Content-Type",
    response: obj({ ok: bool, url: nstr("the new picture's URL, its version in the query") }),
  },
  "DELETE /v1/avatars/{kind}/{id}": {
    response: obj({ ok: bool, removed: { ...bool, description: "false when there was no picture" } }),
  },
  "GET /v1/cli/authorize": {
    query: [{ name: "code", description: "the XXXX-XXXX code `foldrun login` printed" }],
    response: obj({
      code: str("the code, normalised"),
      hostname: str("the machine that asked, as the CLI named it"),
      expiresAt: str("when the request lapses"),
      status: str("pending | approving | approved | denied"),
      createdAt: str("when the CLI asked"),
      requestedFrom: nstr("the network the CLI asked from, coarsened (a.b.c.0/24 or an IPv6 /48); null when not known"),
      requestedCountry: nstr("two-letter country of that request, when the install sits behind Cloudflare; null otherwise"),
      sameNetwork: { type: ["boolean", "null"], description: "the browser looking is on the network that asked; null when either side is not known" },
      approveBy: str("the request can be approved until then — five minutes after it was made"),
      modelAccess: obj({
        offered: { ...bool, description: "the signed-in person looking may let this sign-in also call foldrun's models (an admin of every workspace, on the hosted platform); false when no one is signed in" },
        capUsd: { type: ["number", "null"] },
        dailyUsd: { type: ["number", "null"], description: "the most its model calls may spend per UTC day, USD" },
        walletUsd: { type: "number", description: "the most bought credits may pay for them over the key's life, USD; the plan pays first" },
      }),
    }, ["code", "hostname", "expiresAt", "status", "createdAt", "requestedFrom", "requestedCountry", "sameNetwork", "approveBy"]),
  },
  "POST /v1/cli/authorize": {
    body: obj(
      {
        code: str("the XXXX-XXXX code `foldrun login` printed"),
        decision: str("approve | deny; omitted, approve. Approving a request more than five minutes old is refused with 410"),
        models: { ...bool, description: "with approve: the person's yes to model access (the limits GET shows) — the same key may also call foldrun's models; omitted or false, a platform key only. Ignored for a person who may not give it" },
        shown: { ...obj({ role: str() }), description: "the role the consent page showed; 412 when the person's role has changed since" },
      },
      ["code"],
    ),
    response: obj({ ok: bool, status: str("approved | denied") }),
  },
  "POST /v1/cli/login": {
    body: obj({ hostname: str("the machine asking, for the key's label; letters, digits, . _ - and at most 64 kept; omitted, unknown") }),
    response: obj({
      id: str("the secret the CLI polls GET /v1/cli/login/{id} with — never show it"),
      code: str("XXXX-XXXX, what the person confirms"),
      verifyUrl: str("the page the person confirms on"),
      expiresAt: str("ten minutes from now"),
      interval: { ...int, description: "seconds to wait between polls" },
    }),
  },
  "GET /v1/cli/login/{id}": {
    response: obj(
      {
        status: str("pending | denied | expired | approved"),
        token: str("with approved: the new API key — answered once; the request is gone after"),
        account: str("with approved"),
        email: str("with approved: the person who approved"),
        role: str("with approved: the key's role, the person's own"),
      },
      ["status"],
    ),
  },
  "GET /v1/me": {
    response: obj({
      account: str(),
      owner: nstr("the account owner's email"),
      role: str("owner | admin | editor | viewer"),
      workspaces: { type: ["array", "null"], items: str(), description: "the workspaces the caller may open; null for all" },
      actor: obj({
        kind: str("user | key"),
        email: str("kind user: the person"),
        id: str("kind key: the key's id"),
        label: nstr("kind key"),
        prefix: nstr("kind key: the start of the key, for telling keys apart"),
        createdBy: nstr("kind key: who minted it"),
        createdAt: nstr("kind key"),
        expiresAt: nstr("kind key: when it stops working; null for never"),
        origin: nstr("kind key: cli-login for a key `foldrun login` minted, else null"),
        modelAccess: {
          ...obj({ capUsd: { type: ["number", "null"] }, dailyUsd: { type: ["number", "null"] }, walletUsd: { type: "number" } }),
          type: ["object", "null"],
          description: "kind key: the limits within which this same key may call foldrun's models; null when it opens the platform API alone",
        },
      }, ["kind"]),
      modelsUrl: nstr("where model calls go (the gateway's base, for ANTHROPIC_BASE_URL); null where this install has none"),
      notice: Notice,
      person: {
        ...obj({
          email: str(),
          firstName: nstr(),
          lastName: nstr(),
          timezone: nstr("an IANA zone; null: the browser's"),
        }),
        type: ["object", "null"],
        description: "the person this credential is — a signed-in session, or the one behind a `foldrun login` key; null for any other key and support's view",
      },
    }),
  },
  "GET /v1/me/inbox": {
    query: [
      { name: "bucket", description: "mine | started | team | all; omitted, mine and started" },
      { name: "kind", description: "approval | question | issue | proposal | run" },
      { name: "workspace", description: "one workspace's items" },
      { name: "dismissed", description: "1: the items you set aside, instead of the rest" },
    ],
    response: obj({
      person: str("whose inbox — a key's is the person who minted it"),
      items: arr(
        obj({
          id: str(),
          kind: str("approval | question | issue | proposal | run"),
          bucket: str("mine | started | team"),
          why: str("why it is in that bucket, in a few words"),
          workspace: str(),
          title: str(),
          detail: str(),
          at: str("when it started waiting"),
          href: str("where to act on it, a dashboard path"),
          read: bool,
          dismissed: bool,
        }),
      ),
      counts: obj(
        { mine: int, started: int, team: int, unread: { ...int, description: "unread of mine and started — the top bar's count" } },
        ["mine", "started", "team", "unread"],
      ),
    }),
  },
  "POST /v1/me/inbox": {
    body: obj(
      {
        id: str("one item; or ids"),
        ids: arr(str(), "items, at most 200"),
        action: str("read | unread | dismiss | restore — your own view only: dismissing never decides a gate or resolves an issue"),
      },
      ["action"],
    ),
    response: obj({ ok: bool, read: { ...int, description: "items you have read, in all" }, dismissed: { ...int, description: "items you have set aside, in all" } }),
  },
  "GET /v1/me/invites": {
    response: obj({
      invites: arr(
        obj({
          id: str(),
          account: str("the account it invites you to"),
          role: str("viewer | editor | admin"),
          workspaces: { type: ["array", "null"], items: str(), description: "null for every workspace" },
          invitedBy: str("who made it"),
          createdAt: str(),
          expiresAt: str(),
          path: str("the invite's page"),
        }),
      ),
    }),
  },
  "POST /v1/me/invites/{id}": {
    body: obj({ action: str("join | decline") }, ["action"]),
    response: obj({
      ok: bool,
      joined: bool,
      declined: bool,
      account: str(),
      role: str("the role you joined with"),
      workspaces: { type: ["array", "null"], items: str(), description: "null for every workspace" },
    }),
  },
  "GET /v1/me/notifications": { response: MailPreferences },
  "PATCH /v1/me/notifications": {
    body: obj({
      category: str("one change: the category's id"),
      enabled: bool,
      workspace: nstr("only for this workspace (a per-workspace category); omitted or null, account-wide"),
      preferences: arr(obj({ category: str(), enabled: bool, workspace: nstr() }, ["category", "enabled"]), "several changes at once, in place of category/enabled/workspace"),
    }),
    response: MailPreferences,
  },
  "GET /v1/me/onboarding": {
    query: [{ name: "workspace", description: "add that workspace's checklist to the answer; 404 for a workspace outside the caller's scope or that does not exist" }],
    response: obj({
      steps: arr(OnboardingStep),
      done: int,
      total: int,
      complete: bool,
      next: { ...OnboardingStep, type: ["object", "null"], description: "the first step not done; null when all are" },
      upNext: { ...OnboardingStep, type: ["object", "null"], description: "the first step neither done nor hidden by this person; null when none is left" },
      hidden: arr(str(), "the step ids this person hid; empty for a key"),
      dismissed: { ...bool, description: "this person hid the card; always false for a key" },
      dismissedAt: nstr(),
      welcomedAt: nstr("when this person first opened the welcome flow; null before, and for a key"),
      checklist: { ...WorkspaceChecklist, description: "with ?workspace=: that workspace's checklist (absent otherwise)" },
    }),
  },
  "PATCH /v1/me/onboarding": {
    body: obj({
      dismissed: { ...bool, description: "true hides the card for you; false brings it back" },
      welcomed: { ...bool, description: "true records that you have seen the welcome flow (the home page stops sending you there)" },
      hide: arr(str(), "step ids to hide from your card"),
      show: arr(str(), "step ids to bring back"),
      checklist: ChecklistPatch,
    }),
    response: obj({
      ok: bool,
      dismissed: bool,
      dismissedAt: nstr(),
      welcomedAt: nstr(),
      hidden: arr(str()),
      checklist: obj({ dismissedAt: str(), hidden: arr(str()) }),
    }),
  },
  "GET /v1/me/preferences": { response: Preferences },
  "PATCH /v1/me/preferences": {
    body: obj({
      theme: str("system | light | dark"),
      runViews: arr(RunView, "the whole list, replaced; at most 20"),
    }),
    response: Preferences,
  },
  "GET /v1/team": {
    response: obj({ members: arr(Member) }),
  },
  "PATCH /v1/team/members/{id}": {
    body: obj({
      role: str("admin | editor | viewer — owner is transferred, not set (POST /v1/team/transfer)"),
      workspaces: { type: ["array", "null"], items: str(), description: "the workspaces they may open; null for all — never wider than your own" },
    }),
    response: obj({
      ok: bool,
      role: str("their role now"),
      workspaces: { type: ["array", "null"], items: str(), description: "their workspaces now; null for all" },
    }),
  },
  "DELETE /v1/team/members/{id}": {
    response: OK,
  },
  "POST /v1/team/transfer": {
    body: obj(
      {
        to: str("the member id who becomes the owner"),
        password: str("the owner's current password"),
        code: str("six digits from the app, or a backup code — required when two-step sign-in is on"),
      },
      ["to", "password"],
    ),
    response: OK,
  },
  "POST /v1/unsubscribe": {
    query: [{ name: "token", description: "the signed token from the List-Unsubscribe URL; or sent in the body" }],
    body: obj({
      token: str("as JSON, when it is not in the query. A mail client's one-click POST is the form body List-Unsubscribe=One-Click with the token in the query; the confirmation page posts a form with token and from=page, and is answered 303 back to /unsubscribe"),
    }),
    response: obj({
      ok: bool,
      category: str("the mail category turned off"),
      workspace: nstr("the workspace it was turned off for; null for account-wide"),
    }),
  },
};
