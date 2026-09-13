ARG NODE_IMAGE
FROM ${NODE_IMAGE}

ARG PNPM_VERSION=11.19.0
ARG NPM_VERSION=10.9.2

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "npm@${NPM_VERSION}" "pnpm@${PNPM_VERSION}" --ignore-scripts \
    && npm cache clean --force \
    && test "$(npm --version)" = "${NPM_VERSION}" \
    && test "$(pnpm --version)" = "${PNPM_VERSION}" \
    && groupadd --gid 10001 api-intel \
    && useradd --uid 10001 --gid 10001 --home-dir /opt/api-intel-home --create-home --shell /usr/sbin/nologin api-intel

COPY gitlab-dist/ /opt/api-intel/gitlab-dist/

ENV HOME=/opt/api-intel-home
USER 10001:10001

LABEL org.opencontainers.image.title="API Intelligence GitLab CI adapter"
LABEL org.opencontainers.image.description="Static NestJS API impact and policy evaluation for GitLab merge requests"
LABEL org.opencontainers.image.source="https://github.com/fakrulauzaie/nestjs-api-intelligence-engine"
LABEL org.opencontainers.image.licenses="Apache-2.0"
