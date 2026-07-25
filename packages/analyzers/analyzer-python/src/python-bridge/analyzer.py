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
    from libcst.metadata import MetadataWrapper
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

    def __init__(self, repo_name: str, file_path: str, source_code: str, repo_root: str = ""):
        self.repo = repo_name
        self.file_path = file_path
        # Compute relative path by stripping repo root prefix
        rel = file_path.removeprefix(repo_root).removeprefix("/")
        self.relative_path = rel if rel else file_path
        self.source_lines = source_code.splitlines()
        self.symbols = []
        self.relationships = []
        self.current_class = None
        self.current_function = None
        self.namespace = os.path.splitext(self.relative_path.replace("/", "."))[0]

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

    def make_id(self, symbol_path: str) -> str:
        return f"{self.repo}::{self.relative_path}::{symbol_path}"

    def make_location(self, node: cst.CSTNode) -> dict:
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

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        name = node.name.value
        sid = self.make_id(f"{self.namespace}.{name}")

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
        if func_decorators:
            func_symbol = self.symbols[-len(func_decorators) - 1]  # function is before its decorators
            func_symbol["metadata"]["decorators"] = func_decorators

        self.current_function = name
        return True

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.current_function = None

    def visit_Import(self, node: cst.Import) -> None:
        for name in node.names:
            module_name = name.name.value if hasattr(name.name, 'value') else str(name.name)
            alias = name.asname.name.value if hasattr(name, 'asname') and name.asname else None
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
        module = ""
        if hasattr(node.module, 'value'):
            module = node.module.value
        elif hasattr(node, 'module') and node.module:
            module = str(node.module)
        else:
            module = ""

        for name in node.names:
            imported = name.name.value if hasattr(name.name, 'value') else str(name.name)
            alias = name.asname.name.value if hasattr(name, 'asname') and name.asname else None
            full_name = f"{module}.{imported}" if module else imported
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
        if self.current_function:
            caller_id = self.make_id(
                f"{self.namespace}.{self.current_class}.{self.current_function}"
                if self.current_class else
                f"{self.namespace}.{self.current_function}"
            )

            # Extract callee name from different call forms
            callee_name = None
            if hasattr(node.func, 'value') and hasattr(node.func, 'attr'):
                # obj.method() calls
                callee_name = node.func.attr.value if hasattr(node.func.attr, 'value') else str(node.func.attr)
            elif hasattr(node.func, 'value'):
                # Simple function calls
                callee_name = node.func.value if isinstance(node.func.value, str) else (
                    node.func.value.value if hasattr(node.func.value, 'value') else str(node.func)
                )

            if callee_name:
                callee_id = self.make_id(f"{self.namespace}.{callee_name}")
                self.relationships.append({
                    "id": f"{caller_id}--[CALLS]-->{callee_id}",
                    "sourceSymbolId": caller_id,
                    "targetSymbolId": callee_id,
                    "kind": "CALLS",
                    "metadata": {},
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

        # FastAPI / Flask route decorators
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
            extractor = PythonSymbolExtractor(repo_name, file_path, source, repo_root)
            wrapper.visit(extractor)
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
