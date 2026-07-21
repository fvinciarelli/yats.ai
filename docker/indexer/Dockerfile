# ============================================================
# Indexer Service Dockerfile
# ============================================================
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    addgroup -S codeindexer && adduser -S codeindexer -G codeindexer

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY packages/indexing/package.json packages/indexing/
COPY packages/analyzers/analyzer-interface/package.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/package.json packages/analyzers/analyzer-typescript/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/infra/src packages/infra/src
COPY packages/infra/tsconfig.json packages/infra/
COPY packages/indexing/src packages/indexing/src
COPY packages/indexing/tsconfig.json packages/indexing/
COPY packages/analyzers/analyzer-interface/src packages/analyzers/analyzer-interface/src
COPY packages/analyzers/analyzer-interface/tsconfig.json packages/analyzers/analyzer-interface/
COPY packages/analyzers/analyzer-typescript/src packages/analyzers/analyzer-typescript/src
COPY packages/analyzers/analyzer-typescript/tsconfig.json packages/analyzers/analyzer-typescript/

RUN pnpm build && pnpm install --frozen-lockfile --prod
RUN rm -rf packages/*/src packages/*/tsconfig.json

USER codeindexer

EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "-e", "
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(3002, () => console.log('Indexer listening on 3002'));
"]
