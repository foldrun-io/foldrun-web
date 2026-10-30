// OpenAPI request/response schemas: /api/auth/*, /api/cli/*, /api/me*, /api/team*, /api/unsubscribe, /api/support/*, /api/avatars/*.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Shape, type Schema, obj, str, bool, int, arr, OK } from "./kit.ts";

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
});

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
  "POST /api/auth/email": {
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
  "POST /api/auth/forgot": {
    body: obj({ email: str() }, ["email"]),
    response: obj({ ok: bool, message: str("always the same sentence, whatever the address") }),
  },
  "POST /api/auth/login": {
    body: obj({ email: str(), password: str() }, ["email", "password"]),
    response: obj({
      ok: bool,
      mfa: { ...bool, description: "true: a second factor is on — no session yet; send challenge and a code to POST /api/auth/mfa/verify" },
      challenge: str("with mfa: the five-minute token POST /api/auth/mfa/verify takes"),
      ...SignedIn,
    }, ["ok"]),
  },
  "POST /api/auth/logout": {
    noBody: "the session cookie says which session ends; nothing else is read",
    response: OK,
  },
  "POST /api/auth/mfa/disable": {
    body: obj({ password: str(), code: str("six digits from the app, or one backup code") }, ["password", "code"]),
    response: OK,
  },
  "POST /api/auth/mfa/enable": {
    body: obj({ enrol: str("the enrol token POST /api/auth/mfa/setup answered"), code: str("six digits from the app") }, ["enrol", "code"]),
    response: obj({
      ok: bool,
      backup: arr(str(), "eight backup codes, shown exactly once"),
      otherSessionsEnded: { ...int, description: "the person's other sessions ended now; this browser keeps its own" },
    }),
  },
  "POST /api/auth/mfa/setup": {
    noBody: "the signed-in person is the one enrolling; a fresh secret is drawn here",
    response: obj({
      secret: str("the TOTP secret, base32, for typing into an app by hand"),
      uri: str("the otpauth:// URI an app scans"),
      qr: str("a data: URL of a PNG QR code of uri"),
      enrol: str("a token carrying the sealed secret to POST /api/auth/mfa/enable — nothing is stored until then"),
    }),
  },
  "POST /api/auth/mfa/verify": {
    body: obj(
      {
        challenge: str("the token POST /api/auth/login answered with mfa: true"),
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
  "POST /api/auth/name": {
    body: obj({
      firstName: nstr("at most 80 characters; null or empty clears it"),
      lastName: nstr("at most 80 characters; null or empty clears it"),
    }),
    response: OK,
  },
  "POST /api/auth/password": {
    body: obj({ current: str("your current password"), next: str("at least 10 characters, not your email, not in a known breach") }, ["current", "next"]),
    response: obj({
      ok: bool,
      otherSessionsEnded: { ...int, description: "other browsers signed out; this one stays" },
      message: str("what happened, in a sentence"),
    }),
  },
  "POST /api/auth/reset": {
    body: obj({ token: str("from the reset link"), password: str("the new password") }, ["token", "password"]),
    response: obj({
      ok: bool,
      account: str(),
      signIn: { ...bool, description: "present (true) when a second factor is on: no session was made — sign in, and the login asks for the code" },
    }),
  },
  "GET /api/auth/session": {
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
        }),
        type: ["object", "null"],
        description: "null when not signed in",
      },
      signupOpen: { ...bool, description: "a stranger may sign up on this install" },
      hasUsers: { ...bool, description: "the install has at least one account" },
    }),
  },
  "GET /api/auth/sessions": {
    response: obj({
      revocable: { ...bool, description: "false: this install keeps no session rows, so it cannot list or end them (sessions is then empty)" },
      current: nstr("the id of the session making this request"),
      sessions: arr(SessionRow, "live sessions, most recently seen first"),
    }),
  },
  "DELETE /api/auth/sessions": {
    body: obj({
      id: str("end this one session — never the one asking (use sign out)"),
      others: { ...bool, description: "true: end every session but the one asking; id is then ignored" },
    }),
    response: obj({ ok: { ...bool, description: "false when no live session of yours had that id" }, ended: int }),
  },
  "POST /api/auth/signup": {
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
  "POST /api/auth/timezone": {
    body: obj({ timezone: nstr("an IANA zone, e.g. Australia/Sydney; null goes back to the browser's") }, ["timezone"]),
    response: obj({ ok: bool, timezone: nstr() }),
  },
  "GET /api/auth/verify": {
    query: [{ name: "token", description: "from the confirmation mail, or the link an email change mailed to the new address" }],
    status: "307",
    media: {
      type: "text/html",
      description: "A temporary redirect (307): to /dashboard?verified=1 once the address is verified (and, for an email-change link, the login moved), else to /login?verify=invalid",
    },
  },
  "POST /api/auth/verify/resend": {
    noBody: "the confirmation goes to the signed-in person's own address",
    response: obj({ ok: bool, already: { ...bool, description: "present (true) when the address is already verified; nothing is sent" } }),
  },
  "GET /api/avatars/{kind}/{id}": {
    media: {
      type: "image/*",
      description: "the picture's bytes — image/png, image/jpeg or image/webp; cached for a year (a new picture has a new URL). kind is user | workspace | account",
    },
  },
  "PUT /api/avatars/{kind}/{id}": {
    noBody: "the body is the image's raw bytes, not JSON — a PNG, JPEG or WebP of at most 1 MB, told apart by its bytes, not its Content-Type",
    response: obj({ ok: bool, url: nstr("the new picture's URL, its version in the query") }),
  },
  "DELETE /api/avatars/{kind}/{id}": {
    response: obj({ ok: bool, removed: { ...bool, description: "false when there was no picture" } }),
  },
  "GET /api/cli/authorize": {
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
    }, ["code", "hostname", "expiresAt", "status", "createdAt", "requestedFrom", "requestedCountry", "sameNetwork", "approveBy"]),
  },
  "POST /api/cli/authorize": {
    body: obj(
      {
        code: str("the XXXX-XXXX code `foldrun login` printed"),
        decision: str("approve | deny; omitted, approve. Approving a request more than five minutes old is refused with 410"),
      },
      ["code"],
    ),
    response: obj({ ok: bool, status: str("approved | denied") }),
  },
  "POST /api/cli/login": {
    body: obj({ hostname: str("the machine asking, for the key's label; letters, digits, . _ - and at most 64 kept; omitted, unknown") }),
    response: obj({
      id: str("the secret the CLI polls GET /api/cli/login/{id} with — never show it"),
      code: str("XXXX-XXXX, what the person confirms"),
      verifyUrl: str("the page the person confirms on"),
      expiresAt: str("ten minutes from now"),
      interval: { ...int, description: "seconds to wait between polls" },
    }),
  },
  "GET /api/cli/login/{id}": {
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
  "GET /api/me": {
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
      }, ["kind"]),
    }),
  },
  "GET /api/me/inbox": {
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
  "POST /api/me/inbox": {
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
  "GET /api/me/notifications": { response: MailPreferences },
  "PATCH /api/me/notifications": {
    body: obj({
      category: str("one change: the category's id"),
      enabled: bool,
      workspace: nstr("only for this workspace (a per-workspace category); omitted or null, account-wide"),
      preferences: arr(obj({ category: str(), enabled: bool, workspace: nstr() }, ["category", "enabled"]), "several changes at once, in place of category/enabled/workspace"),
    }),
    response: MailPreferences,
  },
  "GET /api/me/onboarding": {
    response: obj({
      steps: arr(OnboardingStep),
      done: int,
      total: int,
      complete: bool,
      next: { ...OnboardingStep, type: ["object", "null"], description: "the first step not done; null when all are" },
      dismissed: { ...bool, description: "this person hid the card; always false for a key" },
      dismissedAt: nstr(),
    }),
  },
  "PATCH /api/me/onboarding": {
    body: obj({ dismissed: { ...bool, description: "true hides the card for you; false brings it back" } }, ["dismissed"]),
    response: obj({ ok: bool, dismissed: bool, dismissedAt: nstr() }),
  },
  "GET /api/me/preferences": { response: Preferences },
  "PATCH /api/me/preferences": {
    body: obj({
      theme: str("system | light | dark"),
      runViews: arr(RunView, "the whole list, replaced; at most 20"),
    }),
    response: Preferences,
  },
  "GET /api/team": {
    response: obj({ members: arr(Member) }),
  },
  "PATCH /api/team/members/{id}": {
    body: obj({
      role: str("admin | editor | viewer — owner is transferred, not set (POST /api/team/transfer)"),
      workspaces: { type: ["array", "null"], items: str(), description: "the workspaces they may open; null for all — never wider than your own" },
    }),
    response: obj({
      ok: bool,
      role: str("their role now"),
      workspaces: { type: ["array", "null"], items: str(), description: "their workspaces now; null for all" },
    }),
  },
  "DELETE /api/team/members/{id}": {
    response: OK,
  },
  "POST /api/team/transfer": {
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
  "POST /api/unsubscribe": {
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
