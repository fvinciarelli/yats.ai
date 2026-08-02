# ============================================================
# Retriever Service Dockerfile
# ============================================================
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    addgroup -S yats && adduser -S yats -G yats

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY packages/retrieval/package.json packages/retrieval/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/infra/src packages/infra/src
COPY packages/infra/tsconfig.json packages/infra/
COPY packages/retrieval/src packages/retrieval/src
COPY packages/retrieval/tsconfig.json packages/retrieval/

RUN pnpm build && pnpm install --frozen-lockfile --prod

# Keep only prod deps and dist
RUN rm -rf packages/*/src packages/*/tsconfig.json

USER yats

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3001/health || exit 1

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
  server.listen(3001, () => console.log('Retriever listening on 3001'));
"]
