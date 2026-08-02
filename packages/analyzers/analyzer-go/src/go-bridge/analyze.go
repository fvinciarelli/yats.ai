package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"strings"
	"os"
	"path/filepath"
	"strings"
)

// ============================================================
// YATS Go Bridge — analyzes Go source files via go/parser
// ============================================================

type Symbol struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Kind          string            `json:"kind"`
	Language      string            `json:"language"`
	Location      Location          `json:"location"`
	Namespace     string            `json:"namespace"`
	ParentClass   string            `json:"parentClass"`
	Signature     string            `json:"signature"`
	DocComment    string            `json:"docComment"`
	SourceSnippet string            `json:"sourceSnippet"`
	ContentHash   string            `json:"contentHash"`
	Metadata      map[string]any    `json:"metadata"`
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
	filePath   = flag.String("file", "", "Path to the Go source file")
	repoName   = flag.String("repo", "", "Repository name")
	useStdin   = flag.Bool("stdin", false, "Read source from stdin")
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
	relPath := filepath.Base(path)
	pkgName := node.Name.Name
	if pkgName == "" {
		pkgName = filepath.Dir(path)
	}

	a := &analyzer{
		repo:     repo,
		path:     path,
		relPath:  relPath,
		pkgName:  pkgName,
		fset:     fset,
		symbols:  []Symbol{},
		relns:    []Relationship{},
	}

	ast.Walk(a, node)

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

			// Extract fields as properties
			for _, field := range t.Fields.List {
				for _, fname := range field.Names {
					fieldSym := a.makeSymbol(fname.Name, "property", field.Pos(), field.End())
					fieldSym.ParentClass = name
					fieldSym.Namespace = a.pkgName + "." + name
					a.symbols = append(a.symbols, fieldSym)
				}
			}

		case *ast.InterfaceType:
			sym := a.makeSymbol(name, "interface", n.Pos(), n.End())
			a.symbols = append(a.symbols, sym)

			// Extract interface methods
			for _, method := range t.Methods.List {
				for _, mname := range method.Names {
					methSym := a.makeSymbol(mname.Name, "method", method.Pos(), method.End())
					methSym.ParentClass = name
					methSym.Namespace = a.pkgName + "." + name
					a.symbols = append(a.symbols, methSym)
				}
			}
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
			methID := a.makeID(name)
			a.relns = append(a.relns, Relationship{
				ID:             fmt.Sprintf("%s|contains|%s", recvID, methID),
				SourceSymbolID: recvID,
				TargetSymbolID: methID,
				Kind:           "CONTAINS",
			})
		}

		sig := a.funcSignature(n)
		sym := a.makeSymbol(name, kind, n.Pos(), n.End())
		sym.Signature = sig
		sym.ParentClass = parent
		if parent != "" {
			sym.Namespace = a.pkgName + "." + parent
		}
		a.symbols = append(a.symbols, sym)

		// Extract calls within function body
		if n.Body != nil {
			a.extractCalls(n.Body, sym.ID)
		}

	// ---- Import declarations ----
	case *ast.ImportSpec:
		importPath := strings.Trim(n.Path.Value, `"`)
		if n.Name != nil {
			importPath = n.Name.Name + "=" + importPath
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

func (a *analyzer) extractCalls(body *ast.BlockStmt, callerID string) {
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		var calleeName string
		switch fun := call.Fun.(type) {
		case *ast.Ident:
			calleeName = fun.Name
		case *ast.SelectorExpr:
			calleeName = fun.Sel.Name
		default:
			return true
		}

		if calleeName == "" || isBuiltin(calleeName) {
			return true
		}

		calleeID := a.makeID(calleeName)
		a.relns = append(a.relns, Relationship{
			ID:             fmt.Sprintf("%s|calls|%s", callerID, calleeID),
			SourceSymbolID: callerID,
			TargetSymbolID: calleeID,
			Kind:           "CALLS",
		})
		return true
	})
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
