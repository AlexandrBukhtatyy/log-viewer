# syntax=docker/dockerfile:1.7
#
# log-viewer on-prem image — installs the published npm package and serves
# it via the bundled CLI. Two build-args drive the install:
#
#   PKG_VERSION   — version to install (default: latest)
#   NPM_REGISTRY  — registry URL (default: public npmjs.org;
#                   override for closed-network mirrors, e.g. Nexus/Verdaccio)
#
# Example builds:
#   docker build -t log-viewer:0.1.1 \
#     --build-arg PKG_VERSION=0.1.1 .
#
#   docker build -t log-viewer:0.1.1 \
#     --build-arg PKG_VERSION=0.1.1 \
#     --build-arg NPM_REGISTRY=https://nexus.internal/repository/npm-proxy/ .
#
# Fully offline (no registry access at build time):
#   docker save log-viewer:0.1.1 -o log-viewer.tar    # on an internet-connected machine
#   docker load -i log-viewer.tar                     # in the air-gapped network

ARG PKG_VERSION=latest
ARG NPM_REGISTRY=https://registry.npmjs.org/

# ── install stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS install
ARG PKG_VERSION
ARG NPM_REGISTRY
WORKDIR /opt
RUN npm install --prefix /opt --omit=dev --no-fund --no-audit \
      --registry="${NPM_REGISTRY}" \
      "@log-viewer/app@${PKG_VERSION}" \
 && npm cache clean --force

# ── runtime stage ─────────────────────────────────────────────────────────
FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /opt
COPY --from=install --chown=app:app /opt/node_modules /opt/node_modules
USER app

ENV PORT=8080 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["node", "/opt/node_modules/@log-viewer/app/bin/cli.mjs"]
CMD []
