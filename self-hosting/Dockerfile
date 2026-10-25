# foldrun on one machine: the dashboard, the API and the engine in one
# container, every agent step in a throwaway container beside it (through
# the host's Docker socket). Built from the public repositories, side by side:
#
#   foldrun/
#     foldrun-core/  foldrun-platform/  foldrun-web/  foldrun-docs/
#
#   cd foldrun/foldrun-web/self-hosting && docker compose up -d --build
#
# The context is that parent folder (docker-compose.yml says so); the ignore
# file is Dockerfile.dockerignore beside this file.

ARG NODE_IMAGE=node:22.23.4-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY foldrun-core/package.json foldrun-core/package-lock.json ./foldrun-core/
RUN cd foldrun-core && npm ci --ignore-scripts
COPY foldrun-platform/package.json foldrun-platform/package-lock.json ./foldrun-platform/
RUN cd foldrun-platform && npm ci --ignore-scripts
COPY foldrun-web/package.json foldrun-web/package-lock.json ./foldrun-web/
RUN cd foldrun-web && npm ci
COPY foldrun-core ./foldrun-core
COPY foldrun-platform ./foldrun-platform
COPY foldrun-web ./foldrun-web
COPY foldrun-docs ./foldrun-docs
# core's compiled dist: the step runner image is built from it (npm pack) and
# its tag is a fingerprint of it, so it must be this core's — or an upgrade
# would keep running the previous runner.
RUN cd foldrun-core && npx tsc -p tsconfig.json
# The assistant's docs index, then the dashboard. The docs are read at build
# time only.
RUN cd foldrun-web && node scripts/assistant-docs.mjs && cp assistant-docs.json ../foldrun-platform/assistant-docs.json \
 && npx next build && rm -rf /app/foldrun-docs

FROM ${NODE_IMAGE}
# python3 for agents' scripts the platform runs itself; the Docker CLI (from
# Docker's signed apt repository, its key checked by fingerprint) to start
# each step's container through the mounted socket.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 python3-venv \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && gpg --show-keys --with-colons /etc/apt/keyrings/docker.gpg | grep -q '^fpr:::::::::9DC858229FC7DD38854AE2D88D81803C0EBFCD88:$' \
 && echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV FOLDRUN_DATA=/data
# One process: the dashboard and API, and beside them the queue, the
# scheduler and the egress proxy (instrumentation.ts starts them).
ENV FOLDRUN_ROLE=all
ENV FOLDRUN_RUN_ISOLATION=container
EXPOSE 3900 8090
WORKDIR /app/foldrun-web
# Root, deliberately: it drives steps through the mounted Docker socket
# (root:docker on the host), and the /data volume is root-owned. The socket
# makes it root-equivalent anyway; the step containers are the sandbox.
USER root
CMD ["./node_modules/.bin/next", "start", "-p", "3900"]
