FROM node:22-alpine AS build
RUN corepack enable
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY examples/decision-node/package.json ./examples/decision-node/package.json
COPY packages/application-adapters/package.json ./packages/application-adapters/package.json
COPY packages/boundary-generator/package.json ./packages/boundary-generator/package.json
COPY packages/policy-ir/package.json ./packages/policy-ir/package.json
COPY packages/repair-agent/package.json ./packages/repair-agent/package.json
COPY packages/rule-engine/package.json ./packages/rule-engine/package.json
COPY packages/verifier-core/package.json ./packages/verifier-core/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api ./apps/api
COPY examples ./examples
COPY packages ./packages
RUN pnpm --filter @niyam/api... build

FROM node:22-alpine AS runtime
RUN corepack enable
RUN apk add --no-cache git python3 py3-pytest
WORKDIR /workspace
COPY --from=build /workspace ./
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
