/**
 * Version of the analysis pipeline (analyzers + extraction semantics).
 *
 * The server stores this per repository. When a file's content hash matches
 * the last indexed hash, the file is skipped — but ONLY if the stored version
 * equals this constant. Bump it whenever analyzer output semantics change
 * (parser upgrades, new symbol kinds, extraction fixes): the next
 * `yats index` re-analyzes every file automatically, no --force needed.
 */
export const ANALYSIS_SCHEMA_VERSION = 3;
