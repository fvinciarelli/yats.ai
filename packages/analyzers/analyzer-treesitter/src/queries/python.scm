; Tree-sitter query for Python
(class_definition
  name: (identifier) @name) @class

(function_definition
  name: (identifier) @name) @function

(import_statement
  name: (dotted_name) @module) @import

(import_from_statement
  module_name: (dotted_name) @module) @import
