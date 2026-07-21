# ============================================================
# YATS — All-in-one Docker image
# ============================================================
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy all package.json files for workspace resolution
COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY packages/indexing/package.json packages/indexing/
COPY packages/retrieval/package.json packages/retrieval/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/cli/package.json packages/cli/
COPY packages/analyzers/analyzer-interface/package.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/package.json packages/analyzers/analyzer-typescript/
COPY packages/analyzers/analyzer-php/package.json packages/analyzers/analyzer-php/
COPY packages/analyzers/analyzer-python/package.json packages/analyzers/analyzer-python/
COPY packages/analyzers/analyzer-csharp/package.json packages/analyzers/analyzer-csharp/
COPY packages/analyzers/analyzer-treesitter/package.json packages/analyzers/analyzer-treesitter/

RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/infra/src packages/infra/src
COPY packages/infra/tsconfig.json packages/infra/
COPY packages/indexing/src packages/indexing/src
COPY packages/indexing/tsconfig.json packages/indexing/
COPY packages/retrieval/src packages/retrieval/src
COPY packages/retrieval/tsconfig.json packages/retrieval/
COPY packages/mcp-server/src packages/mcp-server/src
COPY packages/mcp-server/tsconfig.json packages/mcp-server/
COPY packages/cli/src packages/cli/src
COPY packages/cli/tsconfig.json packages/cli/
COPY packages/analyzers/analyzer-interface/src packages/analyzers/analyzer-interface/src
COPY packages/analyzers/analyzer-interface/tsconfig.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/src packages/analyzers/analyzer-typescript/src
COPY packages/analyzers/analyzer-typescript/tsconfig.json packages/analyzers/analyzer-typescript/
COPY packages/analyzers/analyzer-php/src packages/analyzers/analyzer-php/src
COPY packages/analyzers/analyzer-php/tsconfig.json packages/analyzers/analyzer-php/
COPY packages/analyzers/analyzer-python/src packages/analyzers/analyzer-python/src
COPY packages/analyzers/analyzer-python/tsconfig.json packages/analyzers/analyzer-python/
COPY packages/analyzers/analyzer-csharp/src packages/analyzers/analyzer-csharp/src
COPY packages/analyzers/analyzer-csharp/tsconfig.json packages/analyzers/analyzer-csharp/
COPY packages/analyzers/analyzer-treesitter/src packages/analyzers/analyzer-treesitter/src
COPY packages/analyzers/analyzer-treesitter/tsconfig.json packages/analyzers/analyzer-treesitter/

# Build
RUN pnpm build

# Prune dev dependencies
RUN pnpm install --frozen-lockfile --prod

# ============================================================
# Runtime
# ============================================================
FROM node:22-alpine

RUN addgroup -S yats && adduser -S yats -G yats

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/infra/dist ./packages/infra/dist
COPY --from=builder /app/packages/indexing/dist ./packages/indexing/dist
COPY --from=builder /app/packages/retrieval/dist ./packages/retrieval/dist
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/analyzers/analyzer-interface/dist ./packages/analyzers/analyzer-interface/dist
COPY --from=builder /app/packages/analyzers/analyzer-typescript/dist ./packages/analyzers/analyzer-typescript/dist
COPY --from=builder /app/packages/analyzers/analyzer-php/dist ./packages/analyzers/analyzer-php/dist
COPY --from=builder /app/packages/analyzers/analyzer-python/dist ./packages/analyzers/analyzer-python/dist
COPY --from=builder /app/packages/analyzers/analyzer-csharp/dist ./packages/analyzers/analyzer-csharp/dist
COPY --from=builder /app/packages/analyzers/analyzer-treesitter/dist ./packages/analyzers/analyzer-treesitter/dist

# Copy workspace config for module resolution
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER yats

EXPOSE 3000

ENV NODE_ENV=production
ENV YATS_PORT=3000
ENV REPOSITORIES_PATH=/repos

ENTRYPOINT ["/entrypoint.sh"]
