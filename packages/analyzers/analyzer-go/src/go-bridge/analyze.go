package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ============================================================
// YATS Go Bridge — analyzes Go source files via go/parser
// ============================================================

type Symbol struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	Language      string         `json:"language"`
	Location      Location       `json:"location"`
	Namespace     string         `json:"namespace"`
	ParentClass   string         `json:"parentClass"`
	Signature     string         `json:"signature"`
	DocComment    string         `json:"docComment"`
	SourceSnippet string         `json:"sourceSnippet"`
	ContentHash   string         `json:"contentHash"`
	Metadata      map[string]any `json:"metadata"`
}

type Location struct {
	Repository   string `json:"repository"`
	RelativePath string `json:"relativePath"`
	StartLine    int    `json:"startLine"`
	EndLine      int    `json:"endLine"`
	StartColumn  int    `json:"startColumn"`
	EndColumn    int    `json:"endColumn"`
}

type Relationship struct {
	ID             string         `json:"id"`
	SourceSymbolID string         `json:"sourceSymbolId"`
	TargetSymbolID string         `json:"targetSymbolId"`
	Kind           string         `json:"kind"`
	Metadata       map[string]any `json:"metadata"`
}

type Result struct {
	Symbols       []Symbol       `json:"symbols"`
	Relationships []Relationship `json:"relationships"`
	Errors        []string       `json:"errors"`
	Warnings      []string       `json:"warnings"`
}

var (
	filePath = flag.String("file", "", "Path to the Go source file")
	repoName = flag.String("repo", "", "Repository name")
	useStdin = flag.Bool("stdin", false, "Read source from stdin")
)

func main() {
	flag.Parse()

	if *filePath == "" || *repoName == "" {
		fmt.Fprintln(os.Stderr, "Usage: analyze --file <path> --repo <name> [--stdin]")
		os.Exit(1)
	}

	var result *Result
	var err error
	if *useStdin {
		result, err = analyzeStdin(*filePath, *repoName)
	} else {
		result, err = analyzeFile(*filePath, *repoName)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(result)
}

func analyzeStdin(path, repo string) (*Result, error) {
	src, err := io.ReadAll(os.Stdin)
	if err != nil {
		return nil, fmt.Errorf("stdin read error: %w", err)
	}

	fset := token.NewFileSet()
	node, err := parser.ParseFile(fset, path, src, parser.ParseComments)
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	return analyzeNode(fset, node, repo, path)
}

func analyzeFile(path, repo string) (*Result, error) {
	fset := token.NewFileSet()
	node, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	return analyzeNode(fset, node, repo, path)
}

func analyzeNode(fset *token.FileSet, node *ast.File, repo, path string) (*Result, error) {
	// Full repo-relative path (not basename) — two files with the same name in
	// different folders must not collide in symbol IDs or resolution heuristics.
	relPath := filepath.ToSlash(path)
	pkgName := node.Name.Name
	if pkgName == "" {
		pkgName = filepath.Dir(path)
	}

	a := &analyzer{
		repo:    repo,
		path:    path,
		relPath: relPath,
		pkgName: pkgName,
		fset:          fset,
		declaredTypes: map[string]string{},
		typeUsages:    map[string]*typeUsage{},
		symbols:       []Symbol{},
		relns:         []Relationship{},
	}

	ast.Walk(a, node)
	a.flushTypeUsages()

	// Route detection pass (P5) — runs after the full walk so handler
	// symbols exist regardless of declaration order.
	a.detectRoutes(node)

	return &Result{
		Symbols:       a.symbols,
		Relationships: a.relns,
	}, nil
}

type analyzer struct {
	repo    string
	path    string
	relPath string
	pkgName string
	fset    *token.FileSet

	currentStruct string
	structFields  map[string][]string // struct name -> field names
	pkgNames      map[string]bool     // imported package names (aliases + last path segment)
	declaredTypes map[string]string   // type name -> exact symbol ID (same file)
	typeUsages    map[string]*typeUsage

	symbols []Symbol
	relns   []Relationship
}

func (a *analyzer) Visit(node ast.Node) ast.Visitor {
	if node == nil {
		return nil
	}

	switch n := node.(type) {

	// ---- Type declarations (structs, interfaces) ----
	case *ast.TypeSpec:
		name := n.Name.Name
		if name == "" {
			return a
		}

		switch t := n.Type.(type) {
		case *ast.StructType:
			sym := a.makeSymbol(name, "struct", n.Pos(), n.End())
			a.detectGoConvention(&sym)
			a.symbols = append(a.symbols, sym)
			a.currentStruct = name
			a.declaredTypes[name] = sym.ID

			// Extract fields as properties
			for _, field := range t.Fields.List {
				for _, fname := range field.Names {
					fieldSym := a.makeSymbol(fname.Name, "property", field.Pos(), field.End())
					fieldSym.ParentClass = name
					fieldSym.Namespace = a.pkgName + "." + name
					a.symbols = append(a.symbols, fieldSym)
				}
				a.recordTypeNode(sym.ID, field.Type, field.Type.Pos(), "declaration")
			}

		case *ast.InterfaceType:
			sym := a.makeSymbol(name, "interface", n.Pos(), n.End())
			a.symbols = append(a.symbols, sym)
			a.declaredTypes[name] = sym.ID

			// Extract interface methods
			for _, method := range t.Methods.List {
				for _, mname := range method.Names {
					methSym := a.makeSymbol(mname.Name, "method", method.Pos(), method.End())
					methSym.ParentClass = name
					methSym.Namespace = a.pkgName + "." + name
					a.symbols = append(a.symbols, methSym)
				}
				a.recordTypeNode(sym.ID, method.Type, method.Type.Pos(), "declaration")
			}

		default:
			// Aliases and named types: `type UserID string`, `type Alias = Other`
			sym := a.makeSymbol(name, "type_alias", n.Pos(), n.End())
			a.symbols = append(a.symbols, sym)
			a.declaredTypes[name] = sym.ID
			a.recordTypeNode(sym.ID, n.Type, n.Type.Pos(), "alias")
		}

	// ---- Function declarations ----
	case *ast.FuncDecl:
		name := n.Name.Name
		if name == "" {
			return a
		}

		kind := "function"
		parent := ""

		// Method with receiver
		if n.Recv != nil && len(n.Recv.List) > 0 {
			kind = "method"
			recvType := a.typeToString(n.Recv.List[0].Type)
			parent = strings.TrimPrefix(recvType, "*")

			// Create relationship: receiver type CONTAINS this method
			recvID := a.makeID(parent)
			// Qualify the method ID with its receiver type — two methods named
			// the same on different types in one package must not collide.
			methID := a.makeID(parent + "." + name)
			a.relns = append(a.relns, Relationship{
				ID:             fmt.Sprintf("%s|contains|%s", recvID, methID),
				SourceSymbolID: recvID,
				TargetSymbolID: methID,
				Kind:           "CONTAINS",
			})
		}

		sig := a.funcSignature(n)
		sym := a.makeSymbol(name, kind, n.Pos(), n.End())
		if parent != "" {
			sym.ID = a.makeID(parent + "." + name)
		}
		sym.Signature = sig
		sym.ParentClass = parent
		if parent != "" {
			sym.Namespace = a.pkgName + "." + parent
		}
		a.symbols = append(a.symbols, sym)

		// Signature types (params, results, receiver) are usages of this symbol.
		if n.Recv != nil {
			for _, field := range n.Recv.List {
				a.recordTypeNode(sym.ID, field.Type, field.Type.Pos(), "receiver")
			}
		}
		if n.Type.Params != nil {
			for _, field := range n.Type.Params.List {
				a.recordTypeNode(sym.ID, field.Type, field.Type.Pos(), "parameter")
			}
		}
		if n.Type.Results != nil {
			for _, field := range n.Type.Results.List {
				a.recordTypeNode(sym.ID, field.Type, field.Type.Pos(), "return")
			}
		}

		// Extract calls within function body (with receiver type map)
		if n.Body != nil {
			scope := a.collectFuncScope(n)
			a.extractCalls(n.Body, sym.ID, scope)
			a.extractTypeUsagesBody(n.Body, sym.ID)
		}

	// ---- Import declarations ----
	case *ast.ImportSpec:
		importPath := strings.Trim(n.Path.Value, `"`)
		if n.Name != nil {
			importPath = n.Name.Name + "=" + importPath
		}
		// Track the imported package name for receiver classification:
		// `services.FetchAll()` — receiver `services` is a package, resolved
		// deterministically by namespace downstream.
		if a.pkgNames == nil {
			a.pkgNames = map[string]bool{}
		}
		if n.Name != nil {
			a.pkgNames[n.Name.Name] = true
		} else {
			parts := strings.Split(strings.Trim(n.Path.Value, `"`), "/")
			if len(parts) > 0 {
				a.pkgNames[parts[len(parts)-1]] = true
			}
		}
		sourceID := a.makeID("import:" + importPath)
		targetID := a.makeID(importPath)
		a.relns = append(a.relns, Relationship{
			ID:             fmt.Sprintf("%s|imports|%s", sourceID, targetID),
			SourceSymbolID: sourceID,
			TargetSymbolID: targetID,
			Kind:           "IMPORTS",
			Metadata:       map[string]any{"importPath": importPath},
		})
	}

	return a
}

// routeVerbs maps selector names to HTTP methods. "" means the method is
// not determined by the selector (e.g. gorilla HandleFunc — the verb comes
// from a Methods() chain or defaults).
var routeVerbs = map[string]string{
	"GET": "GET", "POST": "POST", "PUT": "PUT", "PATCH": "PATCH",
	"DELETE": "DELETE", "OPTIONS": "OPTIONS", "HEAD": "HEAD",
	"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH",
	"Delete": "DELETE", "Options": "OPTIONS", "Head": "HEAD",
	"Handle": "", "HandleFunc": "",
}

// detectRoutes scans the file for route registrations and marks the handler
// function/method symbols as routes with httpMethod/routePath metadata (P5).
// Supported conventions:
//
//	stdlib:      http.HandleFunc("/x", handler)
//	gorilla/mux: r.HandleFunc("/x", handler), r.Handle("/x", handler)
//	gin:         r.GET("/x", handler), g.POST(...)   (all-uppercase verbs)
//	chi:         r.Get("/x", handler), r.Post(...)   (title-case verbs)
//
// Runs after the full AST walk, so handler symbols exist regardless of
// declaration order. Method chains (e.g. mux Methods("GET").Path(...)) are
// not supported — documented heuristic.
func (a *analyzer) detectRoutes(node *ast.File) {
	ast.Inspect(node, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		verb, known := routeVerbs[sel.Sel.Name]
		if !known {
			return true
		}

		framework := "stdlib"
		if sel.Sel.Name == "HandleFunc" || sel.Sel.Name == "Handle" {
			if id, isIdent := sel.X.(*ast.Ident); isIdent && id.Name == "http" {
				framework = "stdlib"
			} else {
				framework = "gorilla"
			}
		} else if sel.Sel.Name == strings.ToUpper(sel.Sel.Name) {
			// All-uppercase verbs (GET, POST) → gin convention
			framework = "gin"
		} else {
			// Title-case verbs (Get, Post) → chi convention
			framework = "chi"
		}

		pathLit, ok := call.Args[0].(*ast.BasicLit)
		if !ok || pathLit.Kind != token.STRING {
			return true
		}
		routePath := strings.Trim(pathLit.Value, `"`)

		var handlerName string
		switch h := call.Args[1].(type) {
		case *ast.Ident:
			handlerName = h.Name
		case *ast.SelectorExpr:
			handlerName = h.Sel.Name
		default:
			return true // inline handler — no symbol to mark
		}

		for i := range a.symbols {
			s := &a.symbols[i]
			if s.Name == handlerName && (s.Kind == "function" || s.Kind == "method") {
				s.Kind = "route"
				s.Metadata["framework"] = framework
				s.Metadata["routePath"] = routePath
				if verb != "" {
					s.Metadata["httpMethod"] = verb
				}
				break
			}
		}
		return true
	})
}

func (a *analyzer) extractCalls(body *ast.BlockStmt, callerID string, scope map[string]scopeEntry) {
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		var calleeName string
		var receiverType, receiverExpr, receiverKind string
		switch fun := call.Fun.(type) {
		case *ast.Ident:
			calleeName = fun.Name
		case *ast.SelectorExpr:
			calleeName = fun.Sel.Name
			// Classify the receiver: `svc.Fetch()` (typed local/param/field),
			// `services.FetchAll()` (imported package), or unknown.
			if x, ok := fun.X.(*ast.Ident); ok {
				receiverExpr = x.Name
				if e, found := scope[x.Name]; found {
					receiverType, receiverKind = e.typ, e.kind
				} else if a.pkgNames != nil && a.pkgNames[x.Name] {
					receiverKind = "package"
					receiverType = x.Name
				}
			}
		default:
			return true
		}

		if calleeName == "" || isBuiltin(calleeName) {
			return true
		}

		calleeID := a.makeID(calleeName)
		rel := Relationship{
			ID:             fmt.Sprintf("%s|calls|%s", callerID, calleeID),
			SourceSymbolID: callerID,
			TargetSymbolID: calleeID,
			Kind:           "CALLS",
			Metadata:       map[string]any{},
		}
		if receiverType != "" {
			rel.Metadata["receiverType"] = receiverType
			rel.Metadata["receiverExpr"] = receiverExpr
			rel.Metadata["receiverKind"] = receiverKind
		} else if receiverExpr != "" {
			rel.Metadata["receiverExpr"] = receiverExpr
		}
		a.relns = append(a.relns, rel)
		return true
	})
}

// scopeEntry is a syntax-level identifier → type mapping used to classify
// call receivers without semantic analysis.
type scopeEntry struct {
	typ  string
	kind string // parameter | local | field
}

// simpleTypeName normalizes a Go type expression for receiver matching:
// "*http.Request" → "Request", "*Service" → "Service". Method namespaces
// are pkg.SimpleName, so qualified/external types would never match otherwise.
func simpleTypeName(t string) string {
	t = strings.TrimPrefix(t, "*")
	if i := strings.LastIndex(t, "/"); i >= 0 {
		t = t[i+1:]
	}
	if i := strings.LastIndex(t, "."); i >= 0 {
		t = t[i+1:]
	}
	return t
}

// collectFuncScope builds the identifier → type map for one function body:
// receiver, parameters, explicit-typed locals (`var x Service`,
// `x := &Service{}`). Call results and `var`-style inference stay unknown.
func (a *analyzer) collectFuncScope(fn *ast.FuncDecl) map[string]scopeEntry {
	scope := map[string]scopeEntry{}

	// Receiver: `func (s *Service) Fetch()` → s → Service
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		if len(fn.Recv.List[0].Names) > 0 {
			scope[fn.Recv.List[0].Names[0].Name] = scopeEntry{
				typ: simpleTypeName(a.typeToString(fn.Recv.List[0].Type)), kind: "parameter",
			}
		}
	}

	// Parameters
	if fn.Type.Params != nil {
		for _, f := range fn.Type.Params.List {
			typ := simpleTypeName(a.typeToString(f.Type))
			for _, name := range f.Names {
				scope[name.Name] = scopeEntry{typ: typ, kind: "parameter"}
			}
		}
	}

	// Locals with explicit types
	if fn.Body != nil {
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			switch d := n.(type) {
			case *ast.DeclStmt:
				if gd, ok := d.Decl.(*ast.GenDecl); ok {
					for _, spec := range gd.Specs {
						if vs, ok := spec.(*ast.ValueSpec); ok {
							typ := a.typeToString(vs.Type)
							for _, name := range vs.Names {
								if typ != "" {
									scope[name.Name] = scopeEntry{typ: simpleTypeName(typ), kind: "local"}
								}
							}
						}
					}
				}
			case *ast.AssignStmt:
				if d.Tok == token.DEFINE {
					for i, rhs := range d.Rhs {
						if i >= len(d.Lhs) {
							break
						}
						typ := ""
						switch r := rhs.(type) {
						case *ast.CompositeLit:
							typ = a.typeToString(r.Type)
						case *ast.UnaryExpr: // &Service{}
							if cl, ok := r.X.(*ast.CompositeLit); ok {
								typ = a.typeToString(cl.Type)
							}
						}
						if typ != "" {
							if id, ok := d.Lhs[i].(*ast.Ident); ok {
								scope[id.Name] = scopeEntry{typ: simpleTypeName(typ), kind: "local"}
							}
						}
					}
				}
			}
			return true
		})
	}

	return scope
}


// ============================================================
// Type usages — USES_TYPE edges
// ============================================================

type typeUsage struct {
	caller string
	name   string
	lines  map[int]bool
	kinds  map[string]bool
}

var goBuiltinTypes = map[string]bool{
	"bool": true, "string": true, "error": true, "byte": true, "rune": true,
	"int": true, "int8": true, "int16": true, "int32": true, "int64": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
	"uintptr": true, "float32": true, "float64": true, "complex64": true,
	"complex128": true, "any": true, "comparable": true, "nil": true,
	"true": true, "false": true, "struct": true, "interface": true,
	"map": true, "chan": true, "func": true,
}

func (a *analyzer) recordTypeUsage(caller, name string, pos token.Pos, kind string) {
	if caller == "" || name == "" || goBuiltinTypes[name] {
		return
	}
	key := caller + "\x00" + name
	usage := a.typeUsages[key]
	if usage == nil {
		usage = &typeUsage{caller: caller, name: name, lines: map[int]bool{}, kinds: map[string]bool{}}
		a.typeUsages[key] = usage
	}
	usage.lines[a.fset.Position(pos).Line] = true
	usage.kinds[kind] = true
}

func (a *analyzer) recordTypeNode(caller string, expr ast.Expr, pos token.Pos, kind string) {
	if expr == nil {
		return
	}
	for _, name := range a.typeNames(expr) {
		a.recordTypeUsage(caller, name, pos, kind)
	}
}

// typeNames flattens a type expression into the simple names it mentions.
func (a *analyzer) typeNames(expr ast.Expr) []string {
	names := []string{}
	switch t := expr.(type) {
	case *ast.Ident:
		names = append(names, t.Name)
	case *ast.SelectorExpr:
		names = append(names, t.Sel.Name)
	case *ast.StarExpr:
		names = append(names, a.typeNames(t.X)...)
	case *ast.ArrayType:
		names = append(names, a.typeNames(t.Elt)...)
	case *ast.MapType:
		names = append(names, a.typeNames(t.Key)...)
		names = append(names, a.typeNames(t.Value)...)
	case *ast.ChanType:
		names = append(names, a.typeNames(t.Value)...)
	case *ast.Ellipsis:
		names = append(names, a.typeNames(t.Elt)...)
	case *ast.IndexExpr:
		names = append(names, a.typeNames(t.X)...)
		names = append(names, a.typeNames(t.Index)...)
	case *ast.IndexListExpr:
		names = append(names, a.typeNames(t.X)...)
		for _, idx := range t.Indices {
			names = append(names, a.typeNames(idx)...)
		}
	case *ast.ParenExpr:
		names = append(names, a.typeNames(t.X)...)
	case *ast.FuncType:
		if t.Params != nil {
			for _, field := range t.Params.List {
				names = append(names, a.typeNames(field.Type)...)
			}
		}
		if t.Results != nil {
			for _, field := range t.Results.List {
				names = append(names, a.typeNames(field.Type)...)
			}
		}
	case *ast.StructType:
		for _, field := range t.Fields.List {
			names = append(names, a.typeNames(field.Type)...)
		}
	case *ast.InterfaceType:
		for _, method := range t.Methods.List {
			names = append(names, a.typeNames(method.Type)...)
		}
	}
	return names
}

// extractTypeUsagesBody finds type mentions inside a function body:
// composite literals (T{}), type assertions (x.(T)), conversions T(x),
// new(T) and explicitly typed var declarations.
func (a *analyzer) extractTypeUsagesBody(body *ast.BlockStmt, caller string) {
	ast.Inspect(body, func(n ast.Node) bool {
		switch t := n.(type) {
		case *ast.CompositeLit:
			if t.Type != nil {
				a.recordTypeNode(caller, t.Type, t.Type.Pos(), "composite")
			}
		case *ast.TypeAssertExpr:
			if t.Type != nil {
				a.recordTypeNode(caller, t.Type, t.Type.Pos(), "assert")
			}
		case *ast.ValueSpec:
			if t.Type != nil {
				a.recordTypeNode(caller, t.Type, t.Type.Pos(), "declaration")
			}
		case *ast.CallExpr:
			if ident, ok := t.Fun.(*ast.Ident); ok {
				if ident.Name == "new" && len(t.Args) == 1 {
					a.recordTypeNode(caller, t.Args[0], t.Args[0].Pos(), "new")
				} else if _, declared := a.declaredTypes[ident.Name]; declared {
					// T(v) conversion — only for types declared in this file:
					// a plain call is indistinguishable syntactically.
					a.recordTypeNode(caller, t.Fun, t.Fun.Pos(), "conversion")
				}
			}
		}
		return true
	})
}

func (a *analyzer) flushTypeUsages() {
	keys := make([]string, 0, len(a.typeUsages))
	for key := range a.typeUsages {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		usage := a.typeUsages[key]
		lines := make([]int, 0, len(usage.lines))
		for line := range usage.lines {
			lines = append(lines, line)
		}
		sort.Ints(lines)
		kinds := make([]string, 0, len(usage.kinds))
		for kind := range usage.kinds {
			kinds = append(kinds, kind)
		}
		sort.Strings(kinds)

		target := a.declaredTypes[usage.name]
		if target == "" {
			target = a.makeID(usage.name)
		}
		a.relns = append(a.relns, Relationship{
			ID:             fmt.Sprintf("%s|uses_type|%s", usage.caller, target),
			SourceSymbolID: usage.caller,
			TargetSymbolID: target,
			Kind:           "USES_TYPE",
			Metadata: map[string]any{
				"typeName":   usage.name,
				"namespace":  a.pkgName,
				"lines":      lines,
				"count":      len(lines),
				"usageKinds": kinds,
			},
		})
	}
}

func (a *analyzer) makeSymbol(name, kind string, pos, end token.Pos) Symbol {
	ns := a.pkgName
	startLine := a.fset.Position(pos).Line
	endLine := a.fset.Position(end).Line
	startCol := a.fset.Position(pos).Column
	endCol := a.fset.Position(end).Column

	return Symbol{
		ID:       a.makeID(name),
		Name:     name,
		Kind:     kind,
		Language: "go",
		Location: Location{
			Repository:   a.repo,
			RelativePath: a.relPath,
			StartLine:    startLine,
			EndLine:      endLine,
			StartColumn:  startCol - 1,
			EndColumn:    endCol - 1,
		},
		Namespace: ns,
		Metadata:  map[string]any{"exported": ast.IsExported(name)},
	}
}

func (a *analyzer) makeID(name string) string {
	return fmt.Sprintf("%s::%s::%s.%s", a.repo, a.relPath, a.pkgName, name)
}

func (a *analyzer) detectGoConvention(sym *Symbol) {
	name := sym.Name
	isTest := strings.HasSuffix(a.relPath, "_test.go")

	switch {
	case strings.HasSuffix(name, "Service"):
		sym.Kind = "service"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "Controller"):
		sym.Kind = "controller"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "Repository"):
		sym.Kind = "repository"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "Handler"):
		sym.Kind = "controller"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "Middleware"):
		sym.Kind = "middleware"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "DTO") || strings.HasSuffix(name, "Dto"):
		sym.Kind = "dto"
		sym.Metadata["detectedByConvention"] = true
	case strings.HasSuffix(name, "Entity") || strings.HasSuffix(name, "Model"):
		sym.Kind = "entity"
		sym.Metadata["detectedByConvention"] = true
	}

	if isTest {
		sym.Kind = "test"
		sym.Metadata["isTest"] = true
	}
}

func (a *analyzer) funcSignature(fn *ast.FuncDecl) string {
	var b strings.Builder
	b.WriteString("func ")
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		b.WriteString("(")
		b.WriteString(a.typeToString(fn.Recv.List[0].Type))
		b.WriteString(") ")
	}
	b.WriteString(fn.Name.Name)
	b.WriteString("(")
	for i, p := range fn.Type.Params.List {
		if i > 0 {
			b.WriteString(", ")
		}
		for j, name := range p.Names {
			if j > 0 {
				b.WriteString(", ")
			}
			b.WriteString(name.Name)
		}
		if len(p.Names) > 0 {
			b.WriteString(" ")
		}
		b.WriteString(a.typeToString(p.Type))
	}
	b.WriteString(")")
	if fn.Type.Results != nil && len(fn.Type.Results.List) > 0 {
		b.WriteString(" ")
		if len(fn.Type.Results.List) > 1 || len(fn.Type.Results.List[0].Names) > 0 {
			b.WriteString("(")
		}
		for i, r := range fn.Type.Results.List {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(a.typeToString(r.Type))
		}
		if len(fn.Type.Results.List) > 1 || len(fn.Type.Results.List[0].Names) > 0 {
			b.WriteString(")")
		}
	}
	return b.String()
}

func (a *analyzer) typeToString(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + a.typeToString(t.X)
	case *ast.SelectorExpr:
		return a.typeToString(t.X) + "." + t.Sel.Name
	case *ast.ArrayType:
		return "[]" + a.typeToString(t.Elt)
	case *ast.MapType:
		return "map[" + a.typeToString(t.Key) + "]" + a.typeToString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
	default:
		return fmt.Sprintf("%T", expr)
	}
}

func isBuiltin(name string) bool {
	builtins := map[string]bool{
		"len": true, "cap": true, "make": true, "new": true,
		"append": true, "copy": true, "delete": true, "close": true,
		"panic": true, "recover": true, "print": true, "println": true,
		"error": true, "string": true, "int": true, "int64": true,
		"float64": true, "bool": true, "byte": true, "rune": true,
		"fmt": true, "Sprintf": true, "Errorf": true,
	}
	return builtins[name]
}
