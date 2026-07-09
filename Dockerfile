# syntax=docker/dockerfile:1
FROM node:24.4.0-slim AS base
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.14 \
    && ln -sf "$BUN_INSTALL/bin/bun" "$BUN_INSTALL/bin/bunx" \
    && npm install -g node-gyp@13.0.1

FROM base AS build
ARG DOKPLOY_OFFICIAL_VERSION=v0.29.8
ARG DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_local
ENV DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION
ENV DOKPLOY_FORK_VERSION=$DOKPLOY_FORK_VERSION
COPY . /usr/src/app
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y python3 make g++ git python3-pip pkg-config libsecret-1-dev && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache bun install --frozen-lockfile

# Deploy only the dokploy app

ENV NODE_ENV=production
RUN bun run --filter './packages/server' build
RUN bun run --filter './apps/dokploy' build

RUN bun install --production --frozen-lockfile --linker hoisted

RUN mkdir -p /prod/dokploy \
    && cp -R /usr/src/app/apps/dokploy/package.json /prod/dokploy/package.json \
    && cp -R /usr/src/app/apps/dokploy/next.config.mjs /prod/dokploy/next.config.mjs \
    && cp -R /usr/src/app/apps/dokploy/public /prod/dokploy/public \
    && cp -R /usr/src/app/apps/dokploy/drizzle /prod/dokploy/drizzle \
    && cp -R /usr/src/app/apps/dokploy/components.json /prod/dokploy/components.json \
    && cp -R /usr/src/app/node_modules /prod/dokploy/node_modules \
    && mkdir -p /prod/dokploy/packages \
    && cp -R /usr/src/app/packages/server /prod/dokploy/packages/server \
    && rm -f /prod/dokploy/node_modules/dokploy \
    && rm -f /prod/dokploy/node_modules/@dokploy/api \
    && rm -f /prod/dokploy/node_modules/@dokploy/schedules

RUN cp -R /usr/src/app/apps/dokploy/.next /prod/dokploy/.next
RUN cp -R /usr/src/app/apps/dokploy/dist /prod/dokploy/dist

FROM base AS dokploy
WORKDIR /app

# Set production
ARG DOKPLOY_OFFICIAL_VERSION=v0.29.8
ARG DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_local
ENV NODE_ENV=production
ENV DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION
ENV DOKPLOY_FORK_VERSION=$DOKPLOY_FORK_VERSION

RUN apt-get update && apt-get install -y curl unzip zip apache2-utils iproute2 rsync git-lfs && git lfs install && rm -rf /var/lib/apt/lists/*

# Copy only the necessary files
COPY --from=build /prod/dokploy/.next ./.next
COPY --from=build /prod/dokploy/dist ./dist
COPY --from=build /prod/dokploy/next.config.mjs ./next.config.mjs
COPY --from=build /prod/dokploy/public ./public
COPY --from=build /prod/dokploy/package.json ./package.json
COPY --from=build /prod/dokploy/drizzle ./drizzle
COPY .env.production ./.env
COPY --from=build /prod/dokploy/components.json ./components.json
COPY --from=build /prod/dokploy/node_modules ./node_modules
COPY --from=build /prod/dokploy/packages ./packages


# Install docker
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh --version 28.5.2 && rm get-docker.sh && curl https://rclone.org/install.sh | bash

# Install Nixpacks and tsx
# | VERBOSE=1 VERSION=1.21.0 bash

ARG NIXPACKS_VERSION=1.41.0
RUN curl -sSL https://nixpacks.com/install.sh -o install.sh \
    && chmod +x install.sh \
    && NIXPACKS_VERSION="$NIXPACKS_VERSION" ./install.sh -y \
    && rm install.sh \
    && bun install -g tsx

# Install Railpack
ARG RAILPACK_VERSION=0.15.4
RUN curl -sSL https://railpack.com/install.sh \
    | RAILPACK_VERSION="$RAILPACK_VERSION" bash -s -- --yes --bin-dir /usr/local/bin

# Install buildpacks
COPY --from=buildpacksio/pack:0.39.1 /usr/local/bin/pack /usr/local/bin/pack

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fs http://localhost:3000/api/trpc/settings.health || exit 1

  CMD ["sh", "-c", "bun run wait-for-postgres && exec bun run start"]
