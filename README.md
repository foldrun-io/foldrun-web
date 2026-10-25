# foldrun-web

The foldrun dashboard and HTTP API: workspaces, runs and their live trails,
the flow canvas, storage, issues, approvals, the inbox, secrets, keys and the
team, and every route the [`foldrun` CLI](https://www.npmjs.com/package/foldrun)
calls. It is a Next.js app that compiles the engine
([foldrun-platform](https://github.com/foldrun-io/foldrun-platform)), the
runtime ([foldrun-core](https://github.com/foldrun-io/foldrun-core)) and the
docs ([foldrun-docs](https://github.com/foldrun-io/foldrun-docs)) straight
from their source, so the four repositories sit side by side:

```
foldrun/
  foldrun-core/  foldrun-platform/  foldrun-web/  foldrun-docs/
```

## Run it on your own server

[`self-hosting/`](self-hosting) builds and starts the whole platform on one
machine with Docker Compose — the dashboard, the API and the engine in one
container, every agent step in a throwaway container beside it:

```sh
cd foldrun-web/self-hosting
echo "FOLDRUN_SECRET_KEY=$(openssl rand -hex 32)" > .env
echo "FOLDRUN_PUBLIC_URL=http://<host>:3900" >> .env   # the address people open
docker compose up -d --build
```

Then sign up at `http://<host>:3900/signup`, `foldrun login --url
http://<host>:3900`, and `foldrun deploy`. `docker-compose.yml` explains
every setting; [Running it yourself](https://docs.foldrun.io/self-hosting)
has the rest.

## Develop

```sh
npm ci
npm run dev       # the dashboard on http://localhost:3900, data in ../data, no sign-in
npm test          # the route, page and consistency tests
npx tsc --noEmit
npm run lint
```

The git hooks in `.githooks/` (turned on by `npm install`) run gitleaks,
eslint, the API guard, the typecheck and the tests before a push, and refuse
billing files (below).

## Billing

foldrun's hosted billing, Stripe and the operator console are not part of
this repository; the hosted build lays them over it from a private one. Here
the API offers no billing route and nothing is charged; spend budgets
(`budget:`) still hold. `scripts/billing-guard.mjs` keeps it that way.

## Licence

Source-available under the [Functional Source License 1.1, Apache 2.0 future
licence](LICENSE): free for your own and your organisation's use, not for
offering foldrun to others as a service. [LICENSING.md](LICENSING.md) says
what is allowed and what needs a commercial licence (hello@foldrun.io).
