// ============================================================
// Symbol Kinds — how every code element is classified
// ============================================================

/** Discriminator for all symbols across all languages */
export enum SymbolKind {
  // ——— Structural ———
  NAMESPACE = "namespace",
  MODULE = "module",
  PACKAGE = "package",

  // ——— Types ———
  CLASS = "class",
  INTERFACE = "interface",
  ENUM = "enum",
  STRUCT = "struct",
  RECORD = "record",
  TYPE_ALIAS = "type_alias",

  // ——— Callables ———
  FUNCTION = "function",
  METHOD = "method",
  CONSTRUCTOR = "constructor",
  LAMBDA = "lambda",

  // ——— Data ———
  PROPERTY = "property",
  FIELD = "field",
  CONSTANT = "constant",
  VARIABLE = "variable",
  PARAMETER = "parameter",

  // ——— Decorators / Metadata ———
  ANNOTATION = "annotation",
  ATTRIBUTE = "attribute",
  DECORATOR = "decorator",

  // ——— Architectural (detected by convention) ———
  CONTROLLER = "controller",
  SERVICE = "service",
  REPOSITORY = "repository",
  DTO = "dto",
  ENTITY = "entity",
  COMMAND = "command",
  QUERY = "query",
  EVENT = "event",
  MIDDLEWARE = "middleware",
  GUARD = "guard",
  INTERCEPTOR = "interceptor",
  PROVIDER = "provider",
  FACTORY = "factory",
  CONFIG = "config",
  MIGRATION = "migration",
  TEST = "test",
  FIXTURE = "fixture",
  ROUTE = "route",
  HOOK = "hook",
  COMPONENT = "component",
}

// ============================================================
// Relationship Kinds — how symbols connect to each other
// ============================================================

export enum RelationshipKind {
  // ——— Structural ———
  CONTAINS = "CONTAINS",
  DECLARES = "DECLARES",
  BELONGS_TO = "BELONGS_TO",

  // ——— OOP ———
  INHERITS = "INHERITS",
  IMPLEMENTS = "IMPLEMENTS",
  OVERRIDES = "OVERRIDES",

  // ——— Dependencies ———
  IMPORTS = "IMPORTS",
  EXPORTS = "EXPORTS",
  DEPENDS_ON = "DEPENDS_ON",
  CALLS = "CALLS",
  REFERENCES = "REFERENCES",
  INSTANTIATES = "INSTANTIATES",

  // ——— Data Flow ———
  RETURNS = "RETURNS",
  ACCEPTS = "ACCEPTS",
  PUBLISHES = "PUBLISHES",
  SUBSCRIBES = "SUBSCRIBES",

  // ——— Testing ———
  TESTS = "TESTS",
  CONFIGURES = "CONFIGURES",

  // ——— Decorators ———
  DECORATES = "DECORATES",

  // ——— Architectural ———
  ROUTES_TO = "ROUTES_TO",
  HANDLES = "HANDLES",
}

// ============================================================
// Languages we support
// ============================================================

export enum Language {
  CSHARP = "csharp",
  GO = "go",
  JAVA = "java",
  JAVASCRIPT = "javascript",
  PHP = "php",
  PYTHON = "python",
  TYPESCRIPT = "typescript",
}

// ============================================================
// Vector collections
// ============================================================

export enum CollectionName {
  CODE = "code",
  DOCUMENTATION = "documentation",
}
