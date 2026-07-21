import { createHash } from "node:crypto";

/**
 * Compute SHA256 hash of content as a hex string.
 * Used for content-based change detection in incremental indexing.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}
