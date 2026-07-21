# ============================================================
# YATS — All-in-one Docker image
# Build args control which language bridges to include:
#   --build-arg INCLUDE_GO=true
#   --build-arg INCLUDE_CSHARP=true
#   --build-arg INCLUDE_PYTHON=true
#   --build-arg INCLUDE_PHP=true
# ============================================================

# ============================================================
# Stage 0: Go bridge builder (optional)
# ============================================================
FROM golang:1.23-alpine AS go-builder
ARG INCLUDE_GO=false
WORKDIR /go-bridge
COPY packages/analyzers/analyzer-go/src/go-bridge/analyze.go .
RUN if [ "$INCLUDE_GO" = "true" ]; then \
      go build -o /go-bridge/yats-go-bridge analyze.go; \
    else \
      touch /go-bridge/yats-go-bridge; \
    fi

# ============================================================
# Stage 1: C# bridge builder (optional)
# ============================================================
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS csharp-builder
ARG INCLUDE_CSHARP=false
WORKDIR /csharp-bridge
COPY packages/analyzers/analyzer-csharp/src/csharp-bridge/RoslynAnalyzer.csproj .
COPY packages/analyzers/analyzer-csharp/src/csharp-bridge/Program.cs .
RUN if [ "$INCLUDE_CSHARP" = "true" ]; then \
      dotnet publish -c Release -o /csharp-bridge/out --self-contained true -r linux-musl-x64; \
    else \
      mkdir -p /csharp-bridge/out && touch /csharp-bridge/out/yats-csharp-bridge; \
    fi

# ============================================================
# Stage 2: Node.js TypeScript build
# ============================================================
FROM node:22-alpine AS node-builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY packages/indexing/package.json packages/indexing/
COPY packages/retrieval/package.json packages/retrieval/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/cli/package.json packages/cli/
COPY packages/analyzers/analyzer-interface/package.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/package.json packages/analyzers/analyzer-typescript/
COPY packages/analyzers/analyzer-go/package.json packages/analyzers/analyzer-go/
COPY packages/analyzers/analyzer-php/package.json packages/analyzers/analyzer-php/
COPY packages/analyzers/analyzer-python/package.json packages/analyzers/analyzer-python/
COPY packages/analyzers/analyzer-csharp/package.json packages/analyzers/analyzer-csharp/
COPY packages/analyzers/analyzer-treesitter/package.json packages/analyzers/analyzer-treesitter/

RUN pnpm install --frozen-lockfile --prod=false

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
COPY packages/analyzers/analyzer-go/src packages/analyzers/analyzer-go/src
COPY packages/analyzers/analyzer-go/tsconfig.json packages/analyzers/analyzer-go/
COPY packages/analyzers/analyzer-php/src packages/analyzers/analyzer-php/src
COPY packages/analyzers/analyzer-php/tsconfig.json packages/analyzers/analyzer-php/
COPY packages/analyzers/analyzer-python/src packages/analyzers/analyzer-python/src
COPY packages/analyzers/analyzer-python/tsconfig.json packages/analyzers/analyzer-python/
COPY packages/analyzers/analyzer-csharp/src packages/analyzers/analyzer-csharp/src
COPY packages/analyzers/analyzer-csharp/tsconfig.json packages/analyzers/analyzer-csharp/
COPY packages/analyzers/analyzer-treesitter/src packages/analyzers/analyzer-treesitter/src
COPY packages/analyzers/analyzer-treesitter/tsconfig.json packages/analyzers/analyzer-treesitter/

RUN pnpm build
RUN pnpm install --frozen-lockfile --prod

# ============================================================
# Stage 3: Runtime
# ============================================================
FROM node:22-alpine

# Optional: install PHP and Python runtimes for bridge scripts
ARG INCLUDE_PHP=false
ARG INCLUDE_PYTHON=false

RUN if [ "$INCLUDE_PHP" = "true" ]; then \
      apk add --no-cache php83 php83-json php83-mbstring; \
    fi

RUN if [ "$INCLUDE_PYTHON" = "true" ]; then \
      apk add --no-cache python3; \
    fi

RUN addgroup -S yats && adduser -S yats -G yats

WORKDIR /app

# Copy Node.js built artifacts
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=node-builder /app/packages/infra/dist ./packages/infra/dist
COPY --from=node-builder /app/packages/indexing/dist ./packages/indexing/dist
COPY --from=node-builder /app/packages/retrieval/dist ./packages/retrieval/dist
COPY --from=node-builder /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=node-builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-interface/dist ./packages/analyzers/analyzer-interface/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-typescript/dist ./packages/analyzers/analyzer-typescript/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-go/dist ./packages/analyzers/analyzer-go/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-php/dist ./packages/analyzers/analyzer-php/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-python/dist ./packages/analyzers/analyzer-python/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-csharp/dist ./packages/analyzers/analyzer-csharp/dist
COPY --from=node-builder /app/packages/analyzers/analyzer-treesitter/dist ./packages/analyzers/analyzer-treesitter/dist
COPY --from=node-builder /app/pnpm-workspace.yaml ./
COPY --from=node-builder /app/package.json ./

# Copy compiled bridge binaries
COPY --from=go-builder /go-bridge/yats-go-bridge /usr/local/bin/yats-go-bridge
COPY --from=csharp-builder /csharp-bridge/out /usr/local/lib/yats-csharp-bridge

# If PHP/Python bridges exist, copy them as scripts (they run via php/python interpreters)
COPY packages/analyzers/analyzer-php/src/php-bridge /usr/local/lib/yats-php-bridge
COPY packages/analyzers/analyzer-python/src/python-bridge /usr/local/lib/yats-python-bridge

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER yats

EXPOSE 3000

ENV NODE_ENV=production
ENV YATS_PORT=3000
ENV REPOSITORIES_PATH=/repos
ENV YATS_GO_BRIDGE=/usr/local/bin/yats-go-bridge
ENV YATS_CSHARP_BRIDGE=/usr/local/lib/yats-csharp-bridge

ENTRYPOINT ["/entrypoint.sh"]
