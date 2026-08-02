// ============================================================
// Neo4j Schema Migration 001
// Idempotent — can be run multiple times safely
// ============================================================

// ----- Constraints -----
CREATE CONSTRAINT symbol_id_unique IF NOT EXISTS
FOR (s:Symbol) REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT repository_name_unique IF NOT EXISTS
FOR (r:Repository) REQUIRE r.name IS UNIQUE;

// ----- Indexes for fast lookups -----
CREATE INDEX symbol_kind_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.kind);

CREATE INDEX symbol_language_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.language);

CREATE INDEX symbol_name_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.name);

CREATE INDEX symbol_repository_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.repository);

CREATE INDEX symbol_namespace_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.namespace);

CREATE INDEX symbol_parent_class_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.parentClass);

// Compound index: repository + kind (common filter combination)
CREATE INDEX symbol_repo_kind_idx IF NOT EXISTS
FOR (s:Symbol) ON (s.repository, s.kind);

// ----- Full-text index for fuzzy name/signature/doc search -----
CREATE FULLTEXT INDEX symbol_text_search IF NOT EXISTS
FOR (s:Symbol) ON EACH [s.name, s.signature, s.docComment];

// ----- Repository node (one per indexed repo) -----
// Each repository gets a :Repository node with metadata
// Created on first index, updated on subsequent indexes
