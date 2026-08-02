; Tree-sitter query for Go
; Extracts: type declarations, functions, methods, imports

(type_declaration
  (type_spec
    name: (type_identifier) @class)) @class

(interface_type
  name: (type_identifier) @interface_declaration)

(function_declaration
  name: (identifier) @function) @function

(method_declaration
  name: (field_identifier) @method) @method

(import_declaration) @import
(import_spec
  name: (package_identifier) @import_name)
