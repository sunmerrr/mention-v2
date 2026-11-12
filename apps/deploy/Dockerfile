# syntax=docker/dockerfile:1.7
# 단일 멀티스테이지 Dockerfile — `--target` 으로 api / web / web-dist 선택.
# → deployment/dockerfile-multistage.md, deployment/single-image-roles.md
# 원칙: 변경 드문 단계를 앞으로(캐시). 환경 값은 이미지에 박지 않는다(build-arg 금지).

# ---------- base ----------
FROM node:24.14.0-slim AS base
# pnpm 버전은 루트 package.json 의 packageManager 필드가 단일 출처.
# corepack prepare pnpm@N 하드코딩 금지 — 필드와 어긋나면 로컬/이미지 재현성이 깨진다.
RUN corepack enable
WORKDIR /app
ENV CI=true

# ---------- deps: 프론트 빌드용 의존성 (코드 X) ----------
# 프론트 앱들은 의존성이 많이 겹치므로 전체 manifest 로 한 번 설치해 공유한다.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# ---------- src + shared 빌드 ----------
FROM deps AS src
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
RUN pnpm --filter @app/shared build

# =====================================================================
# API — 자기 의존성만 설치하고, 타입 검사와 변환을 병렬로 돌린다.
# → deployment/dockerfile-multistage.md "의존성 설치는 target 별 manifest 범위로", "타입 검사와 변환을 별도 스테이지로"
# =====================================================================

# ---------- api-deps: api 와 api 가 쓰는 워크스페이스 패키지 manifest 만 ----------
# 워크스페이스에 manifest 가 전부 있으면 --filter 를 줘도 lockfile 전체가 설치된다.
# api 가 새 워크스페이스 패키지에 의존하게 되면 아래 COPY 목록에도 더한다.
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/api...

FROM api-deps AS api-source
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
RUN pnpm --filter @app/shared build
COPY apps/api/ apps/api/

# ---------- api-typecheck: tsc --noEmit (증분) ----------
# tsbuildinfo 를 캐시 마운트에 두고 바뀐 파일과 그 영향 범위만 다시 검사한다(내용 해시 기준).
# 성공했을 때만 임시 이름으로 쓰고 mv 로 교체 — 같은 빌더의 동시 빌드가 서로의 파일을 깨지 않는다.
# 캐시 마운트 id 는 빌더 전체에서 공유된다. 다른 프로젝트와 섞이지 않게 프로젝트 이름을 붙인다
# (새 프로젝트는 `myapp` 을 자기 이름으로 바꾼다). pnpm-store 는 내용 주소 저장소라 공유해도 된다.
FROM api-source AS api-typecheck
RUN --mount=type=cache,id=mention-api-tsbuildinfo,target=/tsbuild \
    if cp /tsbuild/api.tsbuildinfo /tmp/api.tsbuildinfo 2>/dev/null; \
      then echo "[api-typecheck] tsbuildinfo cache: hit"; \
      else echo "[api-typecheck] tsbuildinfo cache: miss (full check)"; fi; \
    pnpm --filter @app/api exec tsc --noEmit -p tsconfig.build.json \
      --incremental --tsBuildInfoFile /tmp/api.tsbuildinfo --diagnostics \
    && cp /tmp/api.tsbuildinfo "/tsbuild/api.tsbuildinfo.$$" \
    && mv -f "/tsbuild/api.tsbuildinfo.$$" /tsbuild/api.tsbuildinfo \
    && touch /typecheck.ok

# ---------- api-build: SWC 변환만 ----------
# Nest CLI 는 nest-cli.json 의 typeCheck 를 명령줄로 끌 수 없어 typeCheck=false 사본으로 빌드한다.
FROM api-source AS api-build
RUN cd apps/api \
    && node -e "const c=require('./nest-cli.json');c.compilerOptions.typeCheck=false;require('fs').writeFileSync('nest-cli.transpile.json',JSON.stringify(c))" \
    && pnpm exec nest build --builder swc --config nest-cli.transpile.json

# ---------- deploy-api: 런타임용 self-contained 번들 (production deps 만) ----------
# `pnpm deploy --prod` 로 @app/api + 워크스페이스 의존(@app/shared)을 실 디렉토리 node_modules
# 하나로 묶는다. devDependencies(swc/nest-cli/vitest 등)는 제외된다.
FROM api-build AS deploy-api
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @app/api deploy --prod /prod

# ---------- web 빌드 (Vite) ----------
# 환경별 값 없음 — dist 에는 __APP_RUNTIME_CONFIG__ placeholder 만 남는다.
FROM src AS build-web
COPY apps/web/ apps/web/
RUN pnpm --filter @app/web build


# ---------- api 런타임 ----------
FROM node:24.14.0-slim AS api
WORKDIR /app
ENV NODE_ENV=production MENTION_WEB_ROOT=/app/web
# api-typecheck 가 성공해야 이 파일이 있다. 이 COPY 가 없으면 BuildKit 이 typecheck 스테이지를 건너뛴다.
COPY --from=api-typecheck /typecheck.ok /app/.typechecked
# self-contained 번들 하나만 복사(심볼릭 트리 불필요). dist/package.json/node_modules 포함.
COPY --from=deploy-api /prod ./
COPY --from=build-web /app/apps/web/dist /app/web/dist
COPY --from=build-web /app/apps/web/dist-server /app/web/dist-server
USER node
EXPOSE 4200
CMD ["node", "dist/src/main.js"]

# ---------- web 런타임 (nginx + 실행 시 placeholder 치환) ----------
FROM nginx:1.27-alpine AS web
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
COPY apps/deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
# nginx 공식 이미지는 /docker-entrypoint.d/*.sh 를 기동 시 실행한다.
COPY apps/deploy/web/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

# ---------- (선택) web dist 만 — S3 정적 배포용 추출 ----------
FROM scratch AS web-dist
COPY --from=build-web /app/apps/web/dist /
