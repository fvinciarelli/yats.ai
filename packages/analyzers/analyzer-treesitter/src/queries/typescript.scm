; Tree-sitter query for TypeScript
; Extracts classes, interfaces, enums, functions, methods, and imports

(class_declaration
  name: (type_identifier) @name) @class

(interface_declaration
  name: (type_identifier) @name) @interface

(enum_declaration
  name: (identifier) @name) @enum

(function_declaration
  name: (identifier) @name) @function

(method_definition
  name: (property_identifier) @name) @method

(import_statement
  source: (string) @module) @import

(export_statement
  source: (string) @module) @export
