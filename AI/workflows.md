# Workflows

## Adding a New Language Analyzer

**Goal:** Support a new programming language.

1. Create the package under `packages/analyzers/analyzer-<language>/`
2. Create `package.json` with dependency on `@code-indexer/analyzer-interface`
3. Create `src/<language>-analyzer.ts` extending `AbstractAnalyzer`
4. Implement three methods:
   - `canAnalyze(filePath, content): boolean` — check extension
   - `analyze(filePath, content, repoName): Promise<AnalysisResult>` — parse and extract
5. Use `this.createSymbol({...})` and `this.createRelationship(src, tgt, kind)` helpers
6. If the parser runs in a different runtime, create a `bridge/` subdirectory with the bridge script
7. Register in `AnalyzerFactory` (in `cli/src/index.ts` or at startup)
8. Add extension mapping in `language-detector.ts`

**Example:** See `analyzer-typescript` (TS Compiler API, in-process) and `analyzer-php` (PHP-Parser bridge, subprocess).

### Analyzer Interface Contract

```typescript
analyze(filePath, content, repoName) → {
  symbols: Symbol[],        // Required
  relationships: Relationship[],  // Can be empty
  errors: AnalysisError[],  // Non-fatal parse errors
  warnings: AnalysisError[],
}
```

### Convention Detection Pattern

Each analyzer should detect architectural roles:
1. **Name suffix matching** — `*Controller` → CONTROLLER, `*Service` → SERVICE
2. **Framework decorator/attribute matching** — `@Controller()` → CONTROLLER, `@Entity()` → ENTITY
3. **File location heuristics** — files in `tests/` → TEST, files in `config/` → CONFIG

---

## Adding a New MCP Tool

**Goal:** Expose a new capability via MCP.

1. Define the tool schema in `packages/mcp-server/src/tools/all-tools.ts`:
   ```typescript
   const MY_TOOL: ToolDefinition = {
     name: "my_tool",
     description: "What it does",
     inputSchema: { type: "object", properties: {...}, required: [...] },
   };
   ```
2. Add to `getAllToolDefinitions()` array
3. Add a handler in `createToolHandlers()`:
   ```typescript
   handlers.set("my_tool", async (args) => {
     const result = await deps.someRepository.someMethod(args.param);
     return { content: [{ type: "text", text: JSON.stringify(result) }] };
   });
   ```
4. If the tool needs a new dependency, add it to `McpDependencies` interface

---

## Indexing a Repository

**Goal:** Index a codebase so it becomes searchable.

### Full Index
```bash
# Via CLI
code-indexer index /path/to/repo

# Via MCP
# (No MCP tool for indexing — use CLI)
```

### Incremental Index
```bash
code-indexer index /path/to/repo --incremental --since <commit-hash>
```

### Flow
1. `FileWalker` walks the directory tree (respects `.gitignore`, skips `node_modules`/`vendor`)
2. `LanguageDetector` determines the language from file extension
3. `AnalyzerFactory` dispatches to the correct `LanguageAnalyzer`
4. Analyzer extracts `Symbol[]` and `Relationship[]`
5. `MemorySymbolStore` aggregates results in memory
6. `EmbeddingGenerator.embedBatch()` generates vectors in parallel
7. `GraphRepository.upsertSymbols()` + `upsertRelationships()` → Neo4j
8. `VectorRepository.upsertVectors()` → Qdrant
9. `DocumentationIndexer` indexes markdown files into Qdrant `documentation` collection

---

## Searching Code

**Goal:** Find relevant code for a natural language query.

### Via CLI
```bash
code-indexer search "payment processing" --repo myrepo --limit 10
```

### Via MCP
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_code",
    "arguments": { "query": "payment processing", "repository": "myrepo", "limit": 10 }
  }
}
```

### Hybrid Retrieval Pipeline
1. Generate embedding for the query text
2. Vector search in Qdrant `code` collection (top-20 hits)
3. Optionally search `documentation` collection (top-5 hits)
4. Resolve symbol IDs from vector payloads
5. Graph expansion from top-10 seeds in Neo4j (1-hop)
6. Merge vector hits + graph neighbors
7. Deduplicate by symbol ID (file-level limit: 3 per file)
8. Rank by composite score (vector similarity + kind boost + source boost)
9. Compress snippets (truncate to 50 lines, strip imports)
10. Fit within token budget (8000 tokens default)

---

## Navigating Code Relationships

**Goal:** Explore a codebase through its graph.

### Common Traversal Patterns

```bash
# Find what a symbol calls
find_callees(symbolId) → methods/functions called BY this

# Find what calls a symbol
find_callers(symbolId) → methods/functions that call THIS

# Find subclasses
find_inheritors(symbolId) → classes that extend this

# Find implementations
find_implementations(symbolId) → classes implementing this interface

# Find tests
find_tests(symbolId) → tests covering this symbol

# Multi-hop expansion
expand_graph(symbolIds, hops=2, relTypes=["CALLS", "CONTAINS"])
```

---

## Running the MCP Server

**Goal:** Expose the platform to AI agents.

```bash
# Via CLI
code-indexer serve

# Via Docker
docker compose -f docker/docker-compose.yml up mcp-server
```

### MCP Protocol Flow

1. Client sends `initialize` → server responds with capabilities
2. Client sends `tools/list` → server responds with 22 tool definitions
3. Client sends `tools/call` with tool name + arguments → server executes + returns result
4. Client sends `shutdown` → server stops

### Transport

- **Default:** stdio (line-delimited JSON on stdin/stdout)
- Messages: one JSON-RPC object per line
- No HTTP mode implemented yet

---

## Adding a New Service

**Goal:** Create a new application service in indexing or retrieval.

1. Create the class in the appropriate package
2. Receive dependencies via constructor (not DI container directly)
3. Export from the package's `index.ts`
4. Wire in `cli/src/index.ts` if needed for CLI commands

**Pattern:**
```typescript
export class MyService {
  constructor(
    private readonly graphRepo: GraphRepository,
    private readonly embeddings: EmbeddingGenerator,
  ) {}

  async doSomething(): Promise<Result> { ... }
}
```

[← Back to README](./README.md)
