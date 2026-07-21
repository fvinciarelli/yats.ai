; Tree-sitter query for PHP
(class_declaration
  name: (name) @name) @class

(interface_declaration
  name: (name) @name) @interface

(function_definition
  name: (name) @name) @function

(method_declaration
  name: (name) @name) @method

(use_declaration
  name: (name) @module) @import
