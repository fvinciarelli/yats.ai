# AGENTS.md — Instructions for AI Coding Agents

## Before you do anything else

Read the documentation in `AI/` to understand this project:

1. **[AI/README.md](./AI/README.md)** — Start here. Overview, tech stack, document map.
2. **[AI/architecture.md](./AI/architecture.md)** — System design, layers, dependency flow, Mermaid diagrams.
3. **[AI/domain.md](./AI/domain.md)** — Core business concepts: Symbol, Relationship, SymbolKind, etc.
4. **[AI/folders.md](./AI/folders.md)** — What every folder contains and what belongs where.
5. **[AI/conventions.md](./AI/conventions.md)** — Coding patterns actually used in this project.
6. **[AI/workflows.md](./AI/workflows.md)** — Step-by-step guides for common tasks.
7. **[AI/components.md](./AI/components.md)** — Every component: responsibility, deps, public API.
8. **[AI/glossary.md](./AI/glossary.md)** — Project terminology.
9. **[AI/build.md](./AI/build.md)** — How to build, run, test, debug, Docker, env vars.
10. **[AI/decisions.md](./AI/decisions.md)** — Architectural decisions and rationale.
11. **[AI/improvements.md](./AI/improvements.md)** — Technical debt, missing tests, risks, possible refactors.

## Project at a glance

- **Monorepo:** pnpm workspaces, 14 packages under `packages/`
- **Language:** TypeScript (strict), ESM modules
- **Purpose:** Index codebases → build knowledge graph → expose MCP tools to LLMs
- **Key packages:** `shared` (domain), `infra` (Neo4j/Qdrant), `indexing`, `retrieval`, `mcp-server`, `cli`
- **Databases:** Neo4j (graph) + Qdrant (vectors)
- **Protocol:** MCP JSON-RPC over stdio

## Quick commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests
```

## Rules

- Never modify `AI/` documentation unless explicitly asked.
- When in doubt, read the relevant AI document before coding.
- Follow the conventions in AI/conventions.md.
- All interfaces are in `@code-indexer/shared` — implement, don't redefine.
