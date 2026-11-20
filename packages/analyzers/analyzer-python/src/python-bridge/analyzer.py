#!/usr/bin/env python3
"""
Python Code Indexer Bridge

Analyzes Python files using LibCST + Jedi,
outputs JSON representation of symbols and relationships.

Usage: python3 analyzer.py --file <path> [--repo <name>]
       python3 analyzer.py --stdin --file-path <path> [--repo <name>]
       python3 analyzer.py --dir <path> [--repo <name>]
"""

import sys
import os
import json
import hashlib
import argparse
from typing import Optional, Any

# These will be imported if available at runtime
try:
    import libcst as cst
    from libcst.metadata import MetadataWrapper, PositionProvider
    HAS_LIBCST = True
except ImportError:
    HAS_LIBCST = False

try:
    import jedi
    HAS_JEDI = True
except ImportError:
    HAS_JEDI = False


# ============================================================
# Symbol & Relationship Extraction
# ============================================================

class PythonSymbolExtractor(cst.CSTVisitor if HAS_LIBCST else object):
    """Extracts symbols and relationships from Python AST using LibCST."""

    def __init__(self, repo_name: str, file_path: str, source_code: str, repo_root: str = "",
                 positions: dict = None):
        self.repo = repo_name
        # libcst nodes carry no positions by default; PositionProvider supplies
        # them. Without it every symbol/usage was reported at line 1.
        self.positions = positions or {}
        self.file_path = file_path
        # Compute relative path by stripping repo root prefix
        rel = file_path.removeprefix(repo_root).removeprefix("/")
        self.relative_path = rel if rel else file_path
        self.source_lines = source_code.splitlines()
        self.symbols = []
        self.relationships = []
        self.current_class = None
        self.current_function = None
        self.known_modules: set = set()
        self.namespace = os.path.splitext(self.relative_path.replace("/", "."))[0]
        # Module paths imported by this file — used by the resolver to tell
        # same-named classes apart.
        self.imported_modules: set = set()
        # (caller id, type name) -> {lines, kinds}; flushed as USES_TYPE edges.
        self.type_usages: dict = {}
        # class name -> exact symbol id, for same-file USES_TYPE targets
        self.declared_types: dict = {}

    def _get_decorator_name(self, decorator) -> Optional[str]:
        """Extract the full dotted decorator name, handling @app.get, @router.post, etc."""
        deco = decorator.decorator
        # Simple: @decorator or @decorator()
        if hasattr(deco, 'value') and isinstance(deco.value, str):
            name = deco.value
            # If it's a call like @decorator(), deco is the Call, func is the Name
            if hasattr(deco, 'func'):
                func = deco.func
                if hasattr(func, 'value'):
                    name = func.value
            return name
        # Dotted: @app.get, @router.post()
        if hasattr(deco, 'attr') and hasattr(deco, 'value'):
            obj = deco.value.value if hasattr(deco.value, 'value') else str(deco.value)
            attr = deco.attr.value if hasattr(deco.attr, 'value') else str(deco.attr)
            return f"{obj}.{attr}"
        # Call on dotted: @app.get("/path")
        if hasattr(deco, 'func') and hasattr(deco.func, 'attr'):
            func = deco.func
            obj = func.value.value if hasattr(func.value, 'value') else str(func.value)
            attr = func.attr.value if hasattr(func.attr, 'value') else str(func.attr)
            return f"{obj}.{attr}"
        return None

    def _decorator_route_info(self, decorator) -> Optional[dict]:
        """Extract {framework, method, path} from FastAPI/Flask route decorators.

        FastAPI: @app.get("/users"), @router.post("/x")
        Flask:   @app.route("/users", methods=["GET"])
        """
        name = self._get_decorator_name(decorator)
        if not name:
            return None
        deco = decorator.decorator
        obj, _, attr = name.partition(".")
        lower_attr = attr.lower()

        def first_string_arg() -> Optional[str]:
            args = getattr(deco, 'args', [])
            if not args:
                return None
            v = getattr(args[0], 'value', None)
            if v is None:
                return None
            # LibCST SimpleString: .value includes the quotes — strip them.
            if hasattr(v, 'value') and isinstance(v.value, str):
                return v.value.strip("'\"")
            if isinstance(v, str):
                return v.strip("'\"")
            return None

        # Flask: @app.route("/path", methods=["GET"]) — GET by default
        if lower_attr == "route":
            method = "GET"
            args = getattr(deco, 'args', [])
            for arg in args[1:]:
                kw = getattr(arg, 'keyword', None)
                kw_name = kw.value if kw is not None and hasattr(kw, 'value') else None
                if kw_name == "methods" and hasattr(arg.value, 'elements'):
                    for el in arg.value.elements:
                        v = getattr(el.value, 'value', None)
                        if v is not None and isinstance(v, str):
                            method = v.strip("'\"")
                            break
                    break
            return {"framework": "flask", "method": method, "path": first_string_arg()}

        # FastAPI: @app.get("/users"), @router.post(...), bare @get(...)
        if lower_attr in ("get", "post", "put", "patch", "delete", "head", "options", "websocket"):
            return {"framework": "fastapi", "method": lower_attr.upper(), "path": first_string_arg()}

        return None

    def make_id(self, symbol_path: str) -> str:
        return f"{self.repo}::{self.relative_path}::{symbol_path}"

    def node_line(self, node) -> int:
        position = self.positions.get(node) if self.positions else None
        if position is not None:
            return position.start.line
        start = getattr(node, 'start', None)
        return start.line if start else 1

    def make_location(self, node: cst.CSTNode) -> dict:
        position = self.positions.get(node) if self.positions else None
        if position is not None:
            return {
                "repository": self.repo,
                "relativePath": self.relative_path,
                "startLine": position.start.line,
                "endLine": position.end.line,
                "startColumn": position.start.column,
                "endColumn": position.end.column,
            }
        start = node.start if hasattr(node, 'start') else None
        end = node.end if hasattr(node, 'end') else None
        return {
            "repository": self.repo,
            "relativePath": self.relative_path,
            "startLine": start.line if start else 1,
            "endLine": end.line if end else 1,
            "startColumn": start.column if start else 0,
            "endColumn": end.column if end else 0,
        }

    def get_node_text(self, node: cst.CSTNode) -> str:
        try:
            return self.source_lines[node.start.line - 1 : node.end.line]
        except Exception:
            return ""

    # ========================================================
    # Type usages — USES_TYPE edges
    # ========================================================

    PY_BUILTINS = {
        "int", "str", "float", "bool", "bytes", "list", "dict", "set",
        "tuple", "frozenset", "object", "type", "None", "NoneType", "Any",
        "Optional", "Union", "List", "Dict", "Set", "Tuple", "Callable",
        "Iterable", "Iterator", "Sequence", "Mapping", "MutableMapping",
        "Awaitable", "Coroutine", "AsyncIterator", "AsyncIterable", "Literal",
        "TypeVar", "Generic", "Protocol", "Final", "ClassVar", "Annotated",
        "Self", "Never", "NoReturn", "datetime", "date", "time", "Decimal",
        "Path", "Exception", "ValueError", "TypeError", "KeyError", "Enum",
    }

    def _collect_type_names(self, node) -> list:
        """Every simple type name inside an annotation / type expression."""
        if node is None:
            return []
        names = []
        if isinstance(node, cst.Name):
            names.append(node.value)
        elif isinstance(node, cst.Attribute):
            names.append(node.attr.value)
        elif isinstance(node, cst.Subscript):
            names.extend(self._collect_type_names(node.value))
            for element in node.slice:
                if isinstance(element, cst.SubscriptElement):
                    names.extend(self._collect_type_names(element.slice))
        elif isinstance(node, cst.Index):
            names.extend(self._collect_type_names(node.value))
        elif isinstance(node, cst.BinaryOperation):
            names.extend(self._collect_type_names(node.left))
            names.extend(self._collect_type_names(node.right))
        elif isinstance(node, cst.Tuple):
            for element in node.elements:
                names.extend(self._collect_type_names(element))
        elif isinstance(node, cst.Element):
            names.extend(self._collect_type_names(node.value))
        elif isinstance(node, cst.Annotation):
            names.extend(self._collect_type_names(node.annotation))
        elif isinstance(node, cst.Arg):
            names.extend(self._collect_type_names(node.value))
        return names

    def record_type_usage(self, caller_id: str, node, kind: str) -> None:
        """Collect type names mentioned by ``node`` for ``caller_id``."""
        if not caller_id:
            return
        line = self.node_line(node)
        for name in self._collect_type_names(node):
            if not name or name in self.PY_BUILTINS:
                continue
            key = (caller_id, name)
            entry = self.type_usages.setdefault(key, {"lines": set(), "kinds": set()})
            entry["lines"].add(line)
            entry["kinds"].add(kind)

    def current_caller_id(self) -> Optional[str]:
        if self.current_function:
            if self.current_class:
                return self.make_id(f"{self.namespace}.{self.current_class}.{self.current_function}")
            return self.make_id(f"{self.namespace}.{self.current_function}")
        if self.current_class:
            return self.make_id(f"{self.namespace}.{self.current_class}")
        return None

    def visit_AnnAssign(self, node: cst.AnnAssign) -> None:
        # `x: ProfileDto = ...` (local, module-level or class attribute).
        caller = self.current_caller_id()
        if caller and node.annotation:
            self.record_type_usage(caller, node.annotation, "declaration")

    def flush_type_usages(self) -> None:
        """Materialize collected usages as USES_TYPE relationships."""
        usings = sorted(self.imported_modules)
        for (caller_id, name), entry in self.type_usages.items():
            lines = sorted(entry["lines"])
            self.relationships.append({
                "id": f"{caller_id}--[USES_TYPE]-->{name}",
                "sourceSymbolId": caller_id,
                "targetSymbolId": self.declared_types.get(name, self.make_id(name)),
                "kind": "USES_TYPE",
                "metadata": {
                    "typeName": name,
                    "namespace": self.namespace,
                    "usings": usings,
                    "lines": lines,
                    "count": len(lines),
                    "usageKinds": sorted(entry["kinds"]),
                },
            })

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        name = node.name.value
        sid = self.make_id(f"{self.namespace}.{name}")
        self.declared_types[name] = sid

        self.symbols.append({
            "id": sid,
            "name": name,
            "kind": "class",
            "language": "python",
            "location": self.make_location(node),
            "namespace": self.namespace,
            "parentClass": None,
            "signature": None,
            "docComment": node.docstring.value if hasattr(node, 'docstring') and node.docstring else None,
            "sourceSnippet": "\n".join(self.get_node_text(node)[:50]),
            "contentHash": hashlib.sha256("\n".join(self.get_node_text(node)).encode()).hexdigest()[:64],
            "metadata": {},
        })

        # Extract bases (inheritance)
        for base in node.bases:
            if hasattr(base, 'value') and hasattr(base.value, 'value'):
                base_name = base.value.value
                target_id = self.make_id(f"{self.namespace}.{base_name}")
                self.relationships.append({
                    "id": f"{sid}--[INHERITS]-->{target_id}",
                    "sourceSymbolId": sid,
                    "targetSymbolId": target_id,
                    "kind": "INHERITS",
                    "metadata": {},
                })

        # Extract decorators on classes and attach to class metadata
        class_decorators = []
        for decorator in node.decorators:
            deco_name = self._get_decorator_name(decorator)
            if deco_name:
                class_decorators.append(deco_name)
                deco_id = self.make_id(f"{self.namespace}.{name}.@{deco_name}")
                self.symbols.append({
                    "id": deco_id,
                    "name": f"@{deco_name}",
                    "kind": "decorator",
                    "language": "python",
                    "location": self.make_location(decorator),
                    "namespace": self.namespace,
                    "parentClass": name,
                    "signature": None,
                    "docComment": None,
                    "sourceSnippet": f"@{deco_name}",
                    "contentHash": hashlib.sha256(f"@{deco_name}".encode()).hexdigest()[:64],
                    "metadata": {},
                })
                self.relationships.append({
                    "id": f"{deco_id}--[DECORATES]-->{sid}",
                    "sourceSymbolId": deco_id,
                    "targetSymbolId": sid,
                    "kind": "DECORATES",
                    "metadata": {},
                })

        # Attach decorator names to the class symbol for convention detection
        if class_decorators:
            cls_symbol = self.symbols[-len(class_decorators) - 1]  # class is before its decorators
            cls_symbol["metadata"]["decorators"] = class_decorators

        old_class = self.current_class
        self.current_class = name
        return True

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.current_class = None

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        name = node.name.value
        qual_name = f"{self.current_class}.{name}" if self.current_class else name
        sid = self.make_id(f"{self.namespace}.{qual_name}")
        parent_id = self.make_id(f"{self.namespace}.{self.current_class}") if self.current_class else None

        kind = "method" if self.current_class else "function"
        if name == "__init__":
            kind = "constructor"

        # Build signature
        params = []
        for param in node.params.params:
            param_name = param.name.value if hasattr(param.name, 'value') else str(param.name)
            annotation = ""
            if hasattr(param, 'annotation') and param.annotation:
                try:
                    annotation = f": {param.annotation.value}"
                except Exception:
                    pass
            params.append(f"{param_name}{annotation}")

        returns = ""
        if hasattr(node, 'returns') and node.returns:
            try:
                returns = f" -> {node.returns.value}"
            except Exception:
                pass

        signature = f"def {name}({', '.join(params)}){returns}"

        # Type annotations are usages of this function.
        for param in node.params.params:
            if hasattr(param, 'annotation') and param.annotation:
                self.record_type_usage(sid, param.annotation, "parameter")
        if hasattr(node, 'returns') and node.returns:
            self.record_type_usage(sid, node.returns, "return")

        self.symbols.append({
            "id": sid,
            "name": name,
            "kind": kind,
            "language": "python",
            "location": self.make_location(node),
            "namespace": self.namespace,
            "parentClass": self.current_class,
            "signature": signature,
            "docComment": node.docstring.value if hasattr(node, 'docstring') and node.docstring else None,
            "sourceSnippet": "\n".join(self.get_node_text(node)[:50]),
            "contentHash": hashlib.sha256("\n".join(self.get_node_text(node)).encode()).hexdigest()[:64],
            "metadata": {},
        })

        if parent_id:
            self.relationships.append({
                "id": f"{parent_id}--[CONTAINS]-->{sid}",
                "sourceSymbolId": parent_id,
                "targetSymbolId": sid,
                "kind": "CONTAINS",
                "metadata": {},
            })

        # Extract decorators on functions and attach to function metadata
        func_decorators = []
        for decorator in node.decorators:
            deco_name = self._get_decorator_name(decorator)
            if deco_name:
                func_decorators.append(deco_name)
                deco_id = self.make_id(f"{self.namespace}.{qual_name}.@{deco_name}")
                self.symbols.append({
                    "id": deco_id,
                    "name": f"@{deco_name}",
                    "kind": "decorator",
                    "language": "python",
                    "location": self.make_location(decorator),
                    "namespace": self.namespace,
                    "parentClass": self.current_class,
                    "signature": None,
                    "docComment": None,
                    "sourceSnippet": f"@{deco_name}",
                    "contentHash": hashlib.sha256(f"@{deco_name}".encode()).hexdigest()[:64],
                    "metadata": {},
                })

        # Attach decorator names to the function symbol for convention detection
        # Route decorators also carry framework/method/path for find_routes (P5)
        if func_decorators:
            func_symbol = self.symbols[-len(func_decorators) - 1]  # function is before its decorators
            func_symbol["metadata"]["decorators"] = func_decorators
            route_infos = []
            for decorator in node.decorators:
                info = self._decorator_route_info(decorator)
                if info:
                    route_infos.append(info)
            if route_infos:
                func_symbol["metadata"]["routeInfos"] = route_infos

        self.current_function = name
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.current_function = None

    def _dotted_name(self, node) -> str:
        """`app.models` is an Attribute tree, not a string — flatten it."""
        if isinstance(node, cst.Name):
            return node.value
        if isinstance(node, cst.Attribute):
            return f"{self._dotted_name(node.value)}.{node.attr.value}"
        return str(node)

    def visit_Import(self, node: cst.Import) -> None:
        for name in node.names:
            module_name = self._dotted_name(name.name)
            self.imported_modules.add(module_name)
            alias = name.asname.name.value if hasattr(name, 'asname') and name.asname else None
            # Track the name callers use (alias or last path segment) for
            # module-qualified call resolution (`Mod.func()`).
            self.known_modules.add(alias or module_name.split(".")[-1])
            target_id = self.make_id(module_name)
            source_id = self.make_id(f"import:{module_name}")
            self.relationships.append({
                "id": f"{source_id}--[IMPORTS]-->{target_id}",
                "sourceSymbolId": source_id,
                "targetSymbolId": target_id,
                "kind": "IMPORTS",
                "metadata": {"alias": alias},
            })

    def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
        # `from app.models import X` → module is a dotted Attribute tree.
        # Taking `.value` here yielded a Name object and broke the whole
        # analysis (it fell back to the regex analyzer).
        module = self._dotted_name(node.module) if node.module is not None else ""

        if module:
            self.imported_modules.add(module)
        for name in node.names:
            imported = name.name.value if hasattr(name.name, 'value') else str(name.name)
            alias = name.asname.name.value if hasattr(name, 'asname') and name.asname else None
            full_name = f"{module}.{imported}" if module else imported
            self.known_modules.add(alias or module.split(".")[-1] if module else imported)
            target_id = self.make_id(full_name)
            source_id = self.make_id(f"import:{imported}")
            self.relationships.append({
                "id": f"{source_id}--[IMPORTS]-->{target_id}",
                "sourceSymbolId": source_id,
                "targetSymbolId": target_id,
                "kind": "IMPORTS",
                "metadata": {"alias": alias, "module": module},
            })

    def visit_Call(self, node: cst.Call) -> None:
        # isinstance(x, Type) and typing.cast(Type, x) mention the type.
        caller = self.current_caller_id()
        if caller:
            func_name = None
            if isinstance(node.func, cst.Name):
                func_name = node.func.value
            elif isinstance(node.func, cst.Attribute):
                func_name = node.func.attr.value
            if func_name == "isinstance":
                for arg in node.args[1:]:
                    self.record_type_usage(caller, arg, "isinstance")
            elif func_name == "cast" and node.args:
                self.record_type_usage(caller, node.args[0], "cast")

        if self.current_function:
            caller_id = self.make_id(
                f"{self.namespace}.{self.current_class}.{self.current_function}"
                if self.current_class else
                f"{self.namespace}.{self.current_function}"
            )

            # Extract callee name from different call forms
            callee_name = None
            callee_id = None
            callee_meta = {}
            if hasattr(node.func, 'value') and hasattr(node.func, 'attr'):
                # obj.method() calls
                obj = node.func.value
                method = node.func.attr.value if hasattr(node.func.attr, 'value') else str(node.func.attr)
                if isinstance(obj, cst.Name) and obj.value in ('self', 'cls'):
                    # self.x() / cls.x() → qualify with the current class
                    callee_name = method
                    if self.current_class:
                        callee_id = self.make_id(f"{self.namespace}.{self.current_class}.{method}")
                elif isinstance(obj, cst.Name) and obj.value in self.known_modules:
                    # Mod.func() → module-qualified call; the resolver rewrites
                    # it deterministically by namespace (module metadata).
                    callee_name = method
                    callee_id = self.make_id(f"{self.namespace}.{method}")
                    callee_meta = {"module": obj.value, "receiverExpr": obj.value, "receiverKind": "module"}
                else:
                    # Call on another object — can't resolve the receiver's type
                    # without type inference; the emitted ID would be dangling,
                    # so skip it (it would be dropped at storage anyway).
                    return
            elif hasattr(node.func, 'value'):
                # Simple function calls
                callee_name = node.func.value if isinstance(node.func.value, str) else (
                    node.func.value.value if hasattr(node.func.value, 'value') else str(node.func)
                )

            if callee_name:
                if callee_id is None:
                    callee_id = self.make_id(f"{self.namespace}.{callee_name}")
                self.relationships.append({
                    "id": f"{caller_id}--[CALLS]-->{callee_id}",
                    "sourceSymbolId": caller_id,
                    "targetSymbolId": callee_id,
                    "kind": "CALLS",
                    "metadata": callee_meta,
                })


# ============================================================
# Convention Detector
# ============================================================

CONVENTION_PATTERNS = [
    ("Controller", "controller"),
    ("Service", "service"),
    ("Repository", "repository"),
    ("DTO", "dto"),
    ("Dto", "dto"),
    ("Entity", "entity"),
    ("Model", "entity"),
    ("Command", "command"),
    ("Query", "query"),
    ("Event", "event"),
    ("Middleware", "middleware"),
    ("Guard", "guard"),
    ("Interceptor", "interceptor"),
    ("Provider", "provider"),
    ("Factory", "factory"),
    ("Migration", "migration"),
    ("Schema", "dto"),
    ("Serializer", "dto"),
]

FRAMEWORK_DECORATORS = {
    "app.get": "route",
    "app.post": "route",
    "app.put": "route",
    "app.patch": "route",
    "app.delete": "route",
    "app.head": "route",
    "app.options": "route",
    "app.websocket": "route",
    "router.get": "route",
    "router.post": "route",
    "router.put": "route",
    "router.patch": "route",
    "router.delete": "route",
    "router.head": "route",
    "router.options": "route",
    "router.websocket": "route",
    "route": "route",
    "get": "route",
    "post": "route",
    "put": "route",
    "patch": "route",
    "delete": "route",
    "websocket": "route",
    "dataclass": "dto",
    "dataclasses.dataclass": "dto",
    "pydantic": "dto",
    "celery.task": "background_job",
    "task": "background_job",
}


def detect_conventions(repo_name: str, file_path: str, symbols: list) -> list:
    """Apply architectural convention detection to symbols."""
    is_test_file = (
        file_path.startswith("test_")
        or file_path.startswith("tests/")
        or file_path.endswith("_test.py")
        or "/tests/" in file_path
        or "/test/" in file_path
    )

    is_config_file = (
        file_path.endswith(".config.py")
        or "/config/" in file_path
        or "settings" in file_path.lower()
        or "config" in file_path.lower()
    )

    for symbol in symbols:
        if symbol["kind"] not in ("class", "function"):
            continue

        name = symbol["name"]

        for suffix, kind in CONVENTION_PATTERNS:
            if name.endswith(suffix) and symbol["kind"] == "class":
                symbol["kind"] = kind
                symbol["metadata"]["detectedByConvention"] = True

        # FastAPI / Flask route decorators (P5: capture method + path)
        route_infos = symbol.get("metadata", {}).get("routeInfos", [])
        if route_infos and symbol["kind"] == "function":
            info = route_infos[-1]  # the decorator closest to the def
            symbol["kind"] = "route"
            symbol["metadata"]["framework"] = info.get("framework", "fastapi")
            if info.get("method"):
                symbol["metadata"]["httpMethod"] = info["method"]
            if info.get("path"):
                symbol["metadata"]["routePath"] = info["path"]
        else:
            for deco_name, deco_kind in FRAMEWORK_DECORATORS.items():
                if deco_name in symbol.get("metadata", {}).get("decorators", []):
                    if deco_kind == "route" and symbol["kind"] == "function":
                        symbol["kind"] = "route"
                        symbol["metadata"]["framework"] = "fastapi/flask"

        # Django view detection
        if symbol["kind"] == "function" and name.endswith("_view"):
            symbol["kind"] = "route"
            symbol["metadata"]["framework"] = "django"
        if symbol["kind"] == "class" and name.endswith("View"):
            symbol["kind"] = "controller"

        # Test detection
        if is_test_file:
            symbol["kind"] = "test"
            symbol["metadata"]["isTest"] = True

        # Config detection
        if is_config_file and symbol["kind"] not in ("test", "route", "controller"):
            symbol["kind"] = "config"
            symbol["metadata"]["isConfig"] = True

    return symbols


# ============================================================
# Fallback: regex-based analysis (no LibCST)
# ============================================================

import re

def analyze_with_regex(file_path: str, content: str, repo_name: str) -> dict:
    """Fallback analyzer using regex when LibCST is not available."""
    symbols = []
    relationships = []
    namespace = os.path.splitext(os.path.basename(file_path))[0]

    def make_id(path: str) -> str:
        return f"{repo_name}::{file_path}::{path}"

    def get_line(idx: int) -> int:
        return content[:idx].count("\n") + 1

    # Extract class definitions
    for m in re.finditer(r'class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:', content):
        name = m.group(1)
        bases_str = m.group(2) or ""
        sid = make_id(f"{namespace}.{name}")

        symbols.append({
            "id": sid,
            "name": name,
            "kind": "class",
            "language": "python",
            "location": {
                "repository": repo_name,
                "relativePath": file_path,
                "startLine": get_line(m.start()),
                "endLine": get_line(m.end()),
                "startColumn": 0,
                "endColumn": 0,
            },
            "namespace": namespace,
            "parentClass": None,
            "signature": None,
            "docComment": None,
            "sourceSnippet": m.group(0),
            "contentHash": hashlib.sha256(m.group(0).encode()).hexdigest()[:64],
            "metadata": {},
        })

        # Extract bases as inheritance
        for base in bases_str.split(","):
            base = base.strip()
            if base and base != "object":
                target_id = make_id(f"{namespace}.{base}")
                relationships.append({
                    "id": f"{sid}--[INHERITS]-->{target_id}",
                    "sourceSymbolId": sid,
                    "targetSymbolId": target_id,
                    "kind": "INHERITS",
                    "metadata": {},
                })

    # Extract function/method definitions
    for m in re.finditer(r'(?:async\s+)?def\s+(\w+)\s*\(', content):
        name = m.group(1)
        is_method = content.rfind("class ", 0, m.start()) > content.rfind("\n\n", 0, m.start())
        qual_name = f"{namespace}.{name}"
        kind = "method" if is_method else "function"

        if name == "__init__":
            kind = "constructor"

        symbols.append({
            "id": make_id(qual_name),
            "name": name,
            "kind": kind,
            "language": "python",
            "location": {
                "repository": repo_name,
                "relativePath": file_path,
                "startLine": get_line(m.start()),
                "endLine": get_line(m.end()),
                "startColumn": 0,
                "endColumn": 0,
            },
            "namespace": namespace,
            "parentClass": None,
            "signature": m.group(0),
            "docComment": None,
            "sourceSnippet": content[m.start():m.start()+500],
            "contentHash": hashlib.sha256(m.group(0).encode()).hexdigest()[:64],
            "metadata": {},
        })

    # Extract imports
    for m in re.finditer(r'^(?:from\s+(\S+)\s+)?import\s+(.+)$', content, re.MULTILINE):
        module = m.group(1) or ""
        imports = [i.strip().split(" as ")[0].strip() for i in m.group(2).split(",")]
        for imp in imports:
            full_name = f"{module}.{imp}" if module else imp
            target_id = make_id(full_name)
            source_id = make_id(f"import:{imp}")
            relationships.append({
                "id": f"{source_id}--[IMPORTS]-->{target_id}",
                "sourceSymbolId": source_id,
                "targetSymbolId": target_id,
                "kind": "IMPORTS",
                "metadata": {"module": module},
            })

    # Detect conventions on symbols
    symbols = detect_conventions(repo_name, file_path, symbols)

    return {
        "symbols": symbols,
        "relationships": relationships,
        "errors": [],
        "warnings": [],
    }


# ============================================================
# Shared analysis helper
# ============================================================

def analyze_source(source: str, file_path: str, repo_name: str, repo_root: str = "") -> dict:
    """Analyze source code and return symbols + relationships."""
    errors = []

    if HAS_LIBCST:
        try:
            tree = cst.parse_module(source)
            wrapper = MetadataWrapper(tree)
            positions = wrapper.resolve(PositionProvider)
            extractor = PythonSymbolExtractor(repo_name, file_path, source, repo_root, positions)
            wrapper.visit(extractor)
            extractor.flush_type_usages()
            symbols = extractor.symbols
            relationships = extractor.relationships
            symbols = detect_conventions(repo_name, file_path, symbols)
        except Exception as e:
            errors.append({"line": 1, "column": 0, "message": f"LibCST error: {e}", "severity": "error"})
            # Fallback to regex
            result = analyze_with_regex(file_path, source, repo_name)
            symbols = result["symbols"]
            relationships = result["relationships"]
    else:
        result = analyze_with_regex(file_path, source, repo_name)
        symbols = result["symbols"]
        relationships = result["relationships"]

    return {"symbols": symbols, "relationships": relationships, "errors": errors}


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Python Code Indexer Bridge")
    parser.add_argument("--file", help="Analyze a single file by path")
    parser.add_argument("--stdin", action="store_true", help="Read source from stdin instead of file")
    parser.add_argument("--batch", action="store_true", help="Read JSON batch from stdin: {files: [{path, source}], repo}")
    parser.add_argument("--file-path", default="", help="File path for symbol IDs (used with --stdin)")
    parser.add_argument("--dir", help="Analyze all .py files in a directory")
    parser.add_argument("--repo", default=os.path.basename(os.getcwd()), help="Repository name")
    parser.add_argument("--repo-root", default="", help="Repository root path (to compute relative paths)")
    args = parser.parse_args()

    all_symbols = []
    all_relationships = []
    all_errors = []

    if args.batch:
        batch_input = json.loads(sys.stdin.read())
        repo = batch_input.get("repo", args.repo)
        results = []
        for file_entry in batch_input.get("files", []):
            file_path = file_entry["path"]
            source = file_entry["source"]
            result = analyze_source(source, file_path, repo, "")
            results.append(result)
        print(json.dumps(results, indent=2, default=str))
        return

    if args.stdin:
        source = sys.stdin.read()
        file_path = args.file_path or "<stdin>"
        result = analyze_source(source, file_path, args.repo, "")
        all_symbols.extend(result["symbols"])
        all_relationships.extend(result["relationships"])
        all_errors.extend(result["errors"])

    elif args.file:
        try:
            with open(args.file, "r", encoding="utf-8") as f:
                source = f.read()
        except Exception as e:
            all_errors.append({"line": 1, "column": 0, "message": str(e), "severity": "error"})
            source = ""

        if source:
            result = analyze_source(source, args.file, args.repo, args.repo_root)
            all_symbols.extend(result["symbols"])
            all_relationships.extend(result["relationships"])
            all_errors.extend(result["errors"])

    elif args.dir:
        for root, dirs, filenames in os.walk(args.dir):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", ".venv", "venv", ".tox", "node_modules")]
            for f in filenames:
                if f.endswith(".py"):
                    file_path = os.path.join(root, f)
                    try:
                        with open(file_path, "r", encoding="utf-8") as fh:
                            source = fh.read()
                    except Exception as e:
                        all_errors.append({"line": 1, "column": 0, "message": str(e), "severity": "error"})
                        continue

                    result = analyze_source(source, file_path, args.repo, args.repo_root)
                    all_symbols.extend(result["symbols"])
                    all_relationships.extend(result["relationships"])
                    all_errors.extend(result["errors"])
    else:
        sys.stderr.write("Usage: python3 analyzer.py --file <path> | --stdin --file-path <path> [--repo <name>]\n")
        sys.exit(1)

    print(json.dumps({
        "symbols": all_symbols,
        "relationships": all_relationships,
        "errors": all_errors,
        "warnings": [],
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
