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
  step "typecheck (npx tsc --noEmit -p tsconfig.json)" npx --no-install tsc --noEmit -p tsconfig.json
  step "lint (npm run lint)" npm run lint
  step "tests (npm test, incl. OpenAPI completeness)" npm test
}
