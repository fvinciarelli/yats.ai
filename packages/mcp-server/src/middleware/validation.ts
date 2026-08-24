import { z } from "zod";
import { createLogger } from "@yats/shared";

const logger = createLogger("mcp:validation");

// ============================================================
// Zod schemas for MCP tool inputs
// ============================================================

function isSafePath(v: string): boolean {
  // Block system roots and dangerous paths
  const dangerous = ["/", "/root", "/etc", "/dev", "/proc", "/sys", "/var", "/usr", "/home", "/tmp"];
  if (dangerous.includes(v)) return false;
  if (/^[A-Z]:\\?$/i.test(v)) return false; // Windows roots like C:\
  if (!v.includes("/") && !v.includes("\\")) return false; // must have at least one separator
  if (v.includes("..")) return false;
  return true;
}

const safePath = z.string().min(1).max(4096).refine(
  isSafePath,
  { message: "Path traversal or system path not allowed — use a specific project directory" },
);

// Accepts either a short repo name ("lab_hub") or a full path
// ("/home/user/lab_hub") — YATS identifies repos by rootPath, and agents
// often pass the path in `repository` instead of `path`.
const safeRepoName = z.string().min(1).max(4096).refine(
  (v) => (v.includes("/") || v.includes("\\")) ? isSafePath(v) : /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v),
  { message: "Invalid repository name format — use a repo name (e.g. \"lab_hub\") or a full path" },
);

export const schemas = {
  search_code: z.object({
    query: z.string().min(1).max(2000),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    language: z.string().optional(),
    kind: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    includeTests: z.boolean().optional(),
  }),

  search_documentation: z.object({
    query: z.string().min(1).max(2000),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_symbol: z.object({
    name: z.string().min(1).max(500),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    kind: z.string().optional(),
    exact: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_references: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_callers: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_callees: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_implementations: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_inheritors: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_tests: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_routes: z.object({
    repository: safeRepoName.optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    path: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  find_configuration: z.object({
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    key: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  expand_graph: z.object({
    symbolIds: z.array(z.string().max(1024)).min(1).max(50),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    hops: z.number().int().min(1).max(3).optional(),
    relationshipTypes: z.array(z.string()).max(20).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),

  related_symbols: z.object({
    symbolId: z.string().max(1024).optional(),
    name: z.string().max(500).optional(),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),

  list_symbols: z.object({
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    kind: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }),

  repository_summary: z.object({
    path: safePath.optional(),
    repository: safeRepoName.optional(),
  }),

  architecture_summary: z.object({
    path: safePath.optional(),
    repository: safeRepoName.optional(),
  }),

  search_similar: z.object({
    symbolId: z.string().max(1024),
    path: safePath.optional(),
    repository: safeRepoName.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  list_repositories: z.object({}),

  delete_repository: z.object({
    repository: safeRepoName.optional(),
    path: safePath.optional(),
    confirm: z.boolean().optional(),
  }),

  rebuild_vectors: z.object({}),
} satisfies Record<string, z.ZodType<any>>;

export type ToolName = keyof typeof schemas;

/**
 * Validate tool arguments against the zod schema.
 * Returns parsed args on success, or a friendly error with guidance on failure.
 */
export function validateArgs(
  toolName: string,
  args: Record<string, unknown>,
): { ok: true; parsed: Record<string, unknown> } | { ok: false; error: string } {
  const schema = schemas[toolName as ToolName];
  if (!schema) {
    return { ok: true, parsed: args };
  }

  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    logger.warn(`Validation failed for ${toolName}: ${issues}`);

    // Build a friendly message with actionable guidance
    let guidance = "";
    const pathArg = args.path as string | undefined;

    // Detect path-related rejections
    if (pathArg !== undefined && (pathArg === "/" || pathArg === "/home" ||
        ["/root", "/etc", "/dev", "/proc", "/sys", "/var", "/usr", "/tmp"].includes(pathArg))) {
      guidance = `

You tried to index "${pathArg}", which is a system directory.
Indexing system paths would scan the entire filesystem, which is slow and produces garbage results.

What to do:
- Provide a specific project path like "/home/user/my-project" or "C:\\Users\\user\\project"
- Run \`yats list\` on the user's machine to see already-indexed repos
- Ask the user: "Which project directory should I index?"`;
    } else if (pathArg !== undefined && pathArg.includes("..")) {
      guidance = `

Path traversal ("..") is not allowed for security reasons.
Use an absolute path like "/home/user/my-project" instead.`;
    }

    return {
      ok: false,
      error: `Invalid arguments for "${toolName}":${guidance}\n\nTechnical details:\n${issues}`,
    };
  }

  return { ok: true, parsed: result.data as Record<string, unknown> };
}
