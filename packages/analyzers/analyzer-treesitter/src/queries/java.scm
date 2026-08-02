; Tree-sitter query for Java
; Extracts: classes, interfaces, enums, methods, imports

(class_declaration
  name: (identifier) @class) @class

(interface_declaration
  name: (identifier) @interface) @interface

(enum_declaration
  name: (identifier) @enum) @enum

(method_declaration
  name: (identifier) @method) @method

(constructor_declaration
  name: (identifier) @constructor) @constructor

(import_declaration) @import
