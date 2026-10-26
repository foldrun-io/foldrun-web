# shellcheck shell=bash
# What pre-push runs in this repo, after the gitleaks scans in pre-push.
# Mirror CI (.github/workflows) and the box deploy gate; keep it read only.
# Not here: the deploy's end-to-end run (next build + tests/api-e2e.test.ts),
# minutes long and it writes .next/ — run it yourself with `npm run api`.
repo_checks() {
  # The pushed commit carries no billing (the worktree's HEAD is that commit).
  step "billing stays out (scripts/billing-guard.mjs)" node scripts/billing-guard.mjs HEAD
  # No change an API caller would break on, since the deployed web (the
  # newest box version tag in ../foldrun-infra), unless it is versioned.
  step "API guard (scripts/api-guard.mjs)" node scripts/api-guard.mjs
  # TypeScript 7 checks the types; `typescript` stays 6 for eslint and next,
  # which need the compiler API TypeScript 7 does not have yet.
  step "typecheck (npm run typecheck, TypeScript 7)" npm run --silent typecheck
  step "lint (npm run lint)" npm run lint
  step "tests (npm test, incl. OpenAPI completeness)" npm test
}
