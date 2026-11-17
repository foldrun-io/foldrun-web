<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git hooks

Problems are caught before the push, not in CI or the deploy. `.githooks/` is
versioned here and `npm install` (its `prepare` runs `sh .githooks/install.sh`) points `core.hooksPath` at it.

- **pre-commit** (seconds, staged files only): gitleaks with the deploy gate's
  config (`../foldrun-infra/.gitleaks.toml`), `node --check` on `.mjs`,
  `bash -n` + `shellcheck -S error` on `.sh`, YAML parse, eslint.
- **pre-push** (what CI and the deploy gate run): gitleaks over the commits being
  pushed and the pushed tree, the API guard (`scripts/api-guard.mjs`: no change
  an API caller would break on unless it is versioned), then `npm run typecheck` (TypeScript 7), `npm run lint` and `npm test` (OpenAPI completeness included; the e2e build is not).

Hooks only read; they never format, stash or reset. Emergency bypass:
`SKIP_HOOKS=1 git push` (or `--no-verify`) — and say why in the commit or PR.

## Email addresses on a page

Render an address with `<Email value={…} />` (or `<WithEmails text={…} />` for
a sentence holding one), never as `{user.email}`. A proxy in front of the
dashboard may rewrite addresses in the HTML — Cloudflare's Email Obfuscation
did, and React's hydration then threw #418 on every page with one. `<Email>`
never sends an address as one string, so no proxy setting matters. Dialog
text, `title`/`value` attributes and form fields are not page HTML and need
nothing.

## TypeScript: 7 checks, 6 stays for the tools

`npm run typecheck` runs TypeScript 7 (`typescript-7`, an npm alias of
`typescript@7`). The `typescript` package itself stays on 6: typescript-eslint
(through eslint-config-next) and `next build` load TypeScript's JavaScript
API, which TypeScript 7 does not ship yet. When typescript-eslint supports
TypeScript 7, move `typescript` to 7 and drop the alias.

## Words on a page: language files

Every word the dashboard shows lives in `messages/en/<area>.json`, not in the
code (owner, 17 Nov 2026: no language hard-coded; English only, no other
locale until the owner asks). Write
`$t("area.file.key")`, or `$t("…", { n })` for an ICU message with values and
plurals. A sentence with markup inside is one message with tags:
`$rich("…", { link: (chunks) => <Link href=…>{chunks}</Link> })`, and an
element placed inside one is `$el(<LocalTime … />)`. The product's nouns are
defined once in `messages/en/terms.json` and written `{@workspace.one}` in a
message ("Project" today), so renaming a noun is one edit.

- `tests/i18n.test.ts` fails on a key that is missing, unused or does not
  resolve, and on new text written in code (the ratchet against
  `tests/i18n-baseline.json`, which may only shrink).
- `node scripts/i18n-extract.mjs --files <paths>… --write` moves a file's
  text for you; run it until it moves 0, then read the diff.
- A value the code compares (a status, a role, an outcome) is shown through
  its label in `components/value-labels.ts`, never as the raw word; only file
  syntax (`network: trusted`) is shown as written. The test finds raw values
  by type (`scripts/i18n-values.mjs`).
- Never translate code samples, paths, permissions, protocol values or
  anything code compares; route handlers (`route.ts`) are never touched.
