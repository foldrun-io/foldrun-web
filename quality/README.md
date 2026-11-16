# Quality suites

`quality/` runs the open-source self-hosted install, built from this checkout
with a fake model, and tests it the ways a unit test cannot. `run.sh` starts
the stack, runs the suites named, and always stops it.

```sh
bash quality/run.sh                 # the per-push set
bash quality/run.sh all             # everything but the soak
bash quality/run.sh visual e2e      # any list
```

| Suite | What it does |
|---|---|
| `visual` | key dashboard pages, light and dark, against `visual/baselines` |
| `e2e` | sign-up, deploy, run, the API end to end |
| `races` | concurrent writes (409 and retry) |
| `leak` | the image holds no hosted-only code, names or secrets |
| `browser` | sign-in, pages and the enforced CSP in a real browser |
| `load:smoke` … `load:soak` | k6 at rising load |
| `chaos` | a slow model, a restart mid-run |
| `fuzz`, `dast` | Schemathesis over the OpenAPI, the ZAP baseline |

CI (`.github/workflows/quality.yml`) runs the push set on every push and
pull request, `all` nightly and the soak weekly; a failed scheduled run
mails the owner. Reports (and every screenshot) are the `quality-reports`
artifact.

## Visual: the baselines

`visual` takes each page in `visual/dashboard.spec.mjs` at 1360×900, light
and dark, and compares it with `visual/baselines/<page>-<theme>.png`. More
than 100 pixels different fails the run. The artifact then holds
`visual/<test>/…-actual.png`, `-expected.png` and `-diff.png` (changed pixels
in red). Times, versions and ids are masked (`VOLATILE` in the spec; mark an
element `data-volatile` to add one).

The baselines are made in CI, on Linux, in Microsoft's Playwright image,
never on a laptop: another OS draws fonts differently and every compare
would fail.

**A change that is meant to change a page** updates its baselines in the same
pull request:

1. Push the branch.
2. Actions → quality → Run workflow, on that branch, suites `visual:update`.
3. `GH_TOKEN=… bash quality/visual-baselines.sh <that run's id>`
4. Look at the pictures (`git diff --stat quality/visual/baselines`, open
   the changed ones), commit them with the change, and say in the commit
   which pages changed and why.

A new page in the suite gets its baseline the same way; a missing baseline
fails the compare rather than being written silently.

Hosted-only pages (the operator console, Billing and the Claude plan
screens) are not here: a public repository's Actions logs are public. They
join the hosted quality stack (FOL-193).
