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
  an API caller would break on unless it is versioned), then `npx tsc --noEmit`, `npm run lint` and `npm test` (OpenAPI completeness included; the e2e build is not).

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
