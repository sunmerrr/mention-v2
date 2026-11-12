# syntax=docker/dockerfile:1.7
FROM node:24.14.0-slim AS base
WORKDIR /app
ENV CI=true
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=mention-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS verify
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json vite.config.ts vitest.config.ts biome.json playwright.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
RUN pnpm typecheck && pnpm test

FROM verify AS build
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=mention-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM base AS web
ARG BUILD_ID=development
ENV MENTION_BUILD_ID=$BUILD_ID
LABEL org.opencontainers.image.revision=$BUILD_ID
ENV NODE_ENV=production MENTION_LISTEN_HOST=0.0.0.0 MENTION_RUNTIME_DIR=/app/runtime
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/read-api ./apps/read-api
COPY --from=build /app/packages ./packages
RUN mkdir -p /app/runtime && chown node:node /app/runtime
USER node
EXPOSE 8790
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "apps/read-api/src/server.ts", "--production"]
