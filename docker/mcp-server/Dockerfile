# ============================================================
# MCP Server Dockerfile
# ============================================================
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy all packages (needed for workspace resolution)
COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY packages/indexing/package.json packages/indexing/
COPY packages/retrieval/package.json packages/retrieval/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/analyzers/analyzer-interface/package.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/package.json packages/analyzers/analyzer-typescript/

# Install dependencies
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
COPY packages/analyzers/analyzer-interface/src packages/analyzers/analyzer-interface/src
COPY packages/analyzers/analyzer-interface/tsconfig.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/src packages/analyzers/analyzer-typescript/src
COPY packages/analyzers/analyzer-typescript/tsconfig.json packages/analyzers/analyzer-typescript/

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
COPY --from=builder /app/packages/analyzers/analyzer-interface/dist ./packages/analyzers/analyzer-interface/dist
COPY --from=builder /app/packages/analyzers/analyzer-typescript/dist ./packages/analyzers/analyzer-typescript/dist

# Copy workspace config for module resolution
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./

USER yats

EXPOSE 3000

ENV NODE_ENV=production
ENV MCP_TRANSPORT=stdio

# MCP uses stdio — no CMD needed for MCP transport
# For HTTP mode:
# CMD ["node", "--import", "reflect-metadata", "packages/mcp-server/dist/index.js"]
CMD ["node", "-e", "console.log('MCP Server ready (stdio mode)')"]
