using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

// ============================================================
// YATS C# Bridge — analyzes C# source files via Roslyn
// Outputs JSON with symbols, relationships, errors, warnings
//
// Usage:
//   dotnet run -- --file <path> --repo <name>           # reads from file
//   dotnet run -- --file <path> --repo <name> --stdin   # reads content from stdin
// ============================================================

if (args.Length < 2 || args[0] != "--file" || args.Length < 4 || args[2] != "--repo")
{
    Console.Error.WriteLine("Usage: dotnet run -- --file <path> --repo <name> [--stdin]");
    Environment.Exit(1);
}

var filePath = args[1];
var repoName = args[3];
var useStdin = args.Length > 4 && args[4] == "--stdin";

string code;
if (useStdin)
{
    using var reader = new StreamReader(Console.OpenStandardInput(), Console.InputEncoding);
    code = reader.ReadToEnd();
}
else
{
    if (!File.Exists(filePath))
    {
        Console.Error.WriteLine($"File not found: {filePath}");
        Environment.Exit(1);
    }
    code = File.ReadAllText(filePath);
}
var tree = CSharpSyntaxTree.ParseText(code);
var root = tree.GetCompilationUnitRoot();

var analyzer = new CSharpAnalyzer(repoName, filePath);
analyzer.Visit(root);
analyzer.FlushTypeUsages();

var result = new BridgeResult
{
    Symbols = analyzer.Symbols,
    Relationships = analyzer.Relationships
};

var options = new JsonSerializerOptions
{
    WriteIndented = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

Console.WriteLine(JsonSerializer.Serialize(result, options));

// ============================================================
// Types
// ============================================================

public class BridgeSymbol
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Language { get; set; } = "csharp";
    public LocationInfo Location { get; set; } = new();
    public string Namespace { get; set; } = "";
    public string? ParentClass { get; set; }
    public string? Signature { get; set; }
    public string? DocComment { get; set; }
    public string? SourceSnippet { get; set; }
    public string? ContentHash { get; set; }
    public Dictionary<string, object?> Metadata { get; set; } = new();
}

public class LocationInfo
{
    public string Repository { get; set; } = "";
    public string RelativePath { get; set; } = "";
    public int StartLine { get; set; }
    public int EndLine { get; set; }
    public int StartColumn { get; set; }
    public int EndColumn { get; set; }
}

public class BridgeRelationship
{
    public string Id { get; set; } = "";
    public string SourceSymbolId { get; set; } = "";
    public string TargetSymbolId { get; set; } = "";
    public string Kind { get; set; } = "";
    public Dictionary<string, object?> Metadata { get; set; } = new();
}

public class BridgeResult
{
    public List<BridgeSymbol> Symbols { get; set; } = new();
    public List<BridgeRelationship> Relationships { get; set; } = new();
    public List<string> Errors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

// ============================================================
// Analyzer — walks the syntax tree and collects symbols/edges
// ============================================================

public class CSharpAnalyzer : CSharpSyntaxWalker
{
    private readonly string _repo;
    private readonly string _filePath;
    private readonly string _relPath;
    private string _currentNamespace = "";
    private string? _currentParentId;

    /** Type names declared in this file (classes, interfaces, structs, records, enums). */
    private readonly HashSet<string> _declaredTypes = new();

    /** Type name → full symbol ID for types declared in this file (exact INSTANTIATES targets). */
    private readonly Dictionary<string, string> _declaredTypeIds = new();

    /**
     * Namespaces imported by the file's `using` directives. Cross-file type
     * resolution uses them to pick the right candidate when two namespaces
     * declare a type with the same name.
     */
    private readonly HashSet<string> _usingNamespaces = new(StringComparer.Ordinal);

    /**
     * Type usages collected while walking, keyed by (referencing symbol, type
     * name). A type mentioned 40 times by one method becomes ONE edge carrying
     * 40 lines instead of 40 edges.
     */
    private readonly Dictionary<(string CallerId, string TypeName), TypeUsage> _typeUsages = new();

    private sealed class TypeUsage
    {
        public SortedSet<int> Lines { get; } = new();
        public SortedSet<string> Kinds { get; } = new(StringComparer.Ordinal);
        /** Namespace in effect at the usage site (a file can hold several). */
        public string Namespace { get; set; } = "";
    }

    /** Innermost member whose body is being walked — source of CALLS/INSTANTIATES edges. */
    private string? _currentCallerId;

    /**
     * Syntax-level type map for the current type scope:
     * identifier → (simple type name, kind: field | property | parameter | local).
     * Swapped per type declaration so members of one class never leak into another.
     */
    private Dictionary<string, (string Type, string Kind)> _scopeTypes = new();

    public List<BridgeSymbol> Symbols { get; } = new();
    public List<BridgeRelationship> Relationships { get; } = new();

    private static readonly SHA256 _sha = SHA256.Create();

    public CSharpAnalyzer(string repo, string filePath)
    {
        _repo = repo;
        _filePath = filePath;
        // Full repo-relative path (not basename) — two files with the same name
        // in different folders must not collide in symbol IDs or resolution.
        _relPath = filePath.Replace('\\', '/').TrimStart('.', '/');
    }

    // ============================================================
    // Namespace
    // ============================================================

    public override void VisitNamespaceDeclaration(NamespaceDeclarationSyntax node)
    {
        _currentNamespace = node.Name.ToString();
        base.VisitNamespaceDeclaration(node);
    }

    public override void VisitFileScopedNamespaceDeclaration(FileScopedNamespaceDeclarationSyntax node)
    {
        _currentNamespace = node.Name.ToString();
        base.VisitFileScopedNamespaceDeclaration(node);
    }

    // ============================================================
    // Type declarations
    // ============================================================

    public override void VisitClassDeclaration(ClassDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "CLASS", node);
        DetectConvention(sym, name);
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;

        // Track parent for CONTAINS
        var previousParent = _currentParentId;
        _currentParentId = sym.Id;

        // Fresh type scope for this class
        var previousScope = _scopeTypes;
        _scopeTypes = new Dictionary<string, (string Type, string Kind)>();

        // Inheritance
        if (node.BaseList != null)
        {
            foreach (var baseType in node.BaseList.Types)
            {
                var baseName = ExtractSimpleName(baseType.Type.ToString());
                var baseId = MakeId(baseName);
                var relKind = baseName.StartsWith("I") ? "IMPLEMENTS" : "INHERITS";
                Relationships.Add(new BridgeRelationship
                {
                    Id = $"{sym.Id}|{relKind.ToLower()}|{baseId}",
                    SourceSymbolId = sym.Id,
                    TargetSymbolId = baseId,
                    Kind = relKind
                });
            }
        }

        ExtractAttributes(node.AttributeLists, sym);
        Symbols.Add(sym);
        base.VisitClassDeclaration(node);

        _currentParentId = previousParent;
        _scopeTypes = previousScope;
    }

    public override void VisitInterfaceDeclaration(InterfaceDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "INTERFACE", node);
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;
        var previousScope = _scopeTypes;
        _scopeTypes = new Dictionary<string, (string Type, string Kind)>();

        // Base interfaces
        if (node.BaseList != null)
        {
            foreach (var baseType in node.BaseList.Types)
            {
                var baseName = ExtractSimpleName(baseType.Type.ToString());
                var baseId = MakeId(baseName);
                Relationships.Add(new BridgeRelationship
                {
                    Id = $"{sym.Id}|inherits|{baseId}",
                    SourceSymbolId = sym.Id,
                    TargetSymbolId = baseId,
                    Kind = "INHERITS"
                });
            }
        }

        Symbols.Add(sym);
        base.VisitInterfaceDeclaration(node);

        _currentParentId = previousParent;
        _scopeTypes = previousScope;
    }

    public override void VisitEnumDeclaration(EnumDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "ENUM", node);
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;

        // Enum members
        foreach (var member in node.Members)
        {
            var memberName = member.Identifier.Text;
            var memberId = MakeId($"{name}.{memberName}");
            Symbols.Add(MakeMemberSymbol(memberName, "ENUM_MEMBER", member, memberId));
            Relationships.Add(MakeContains(sym.Id, memberId));
        }

        Symbols.Add(sym);
        base.VisitEnumDeclaration(node);
    }

    public override void VisitStructDeclaration(StructDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "STRUCT", node);
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;
        var previousScope = _scopeTypes;
        _scopeTypes = new Dictionary<string, (string Type, string Kind)>();

        ExtractAttributes(node.AttributeLists, sym);
        Symbols.Add(sym);
        base.VisitStructDeclaration(node);

        _currentParentId = previousParent;
        _scopeTypes = previousScope;
    }

    public override void VisitRecordDeclaration(RecordDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var kind = node.Kind() == SyntaxKind.RecordStructDeclaration ? "STRUCT" : "CLASS";
        var sym = MakeSymbol(name, kind, node);
        sym.Metadata["isRecord"] = true;
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;
        var previousScope = _scopeTypes;
        _scopeTypes = new Dictionary<string, (string Type, string Kind)>();

        Symbols.Add(sym);
        base.VisitRecordDeclaration(node);

        _currentParentId = previousParent;
        _scopeTypes = previousScope;
    }

    public override void VisitDelegateDeclaration(DelegateDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "DELEGATE", node);
        _declaredTypes.Add(name);
        _declaredTypeIds[name] = sym.Id;
        sym.Signature = node.ToString().Split('{', ';')[0].Trim();
        RecordTypeNode(sym.Id, node.ReturnType, LineOf(node), "return");
        foreach (var parameter in node.ParameterList.Parameters)
            RecordTypeNode(sym.Id, parameter.Type, LineOf(parameter), "parameter");
        Symbols.Add(sym);
    }

    // ============================================================
    // Members
    // ============================================================

    public override void VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeMemberSymbol(name, "METHOD", node, MakeId(name));

        // Build clean signature with generic info
        var returnType = node.ReturnType.ToString();
        var typeParams = node.TypeParameterList?.ToString() ?? "";
        var parameters = node.ParameterList?.ToString() ?? "()";
        var modifiers = string.Join(" ", node.Modifiers.Select(m => m.Text));
        sym.Signature = $"{modifiers} {returnType}{typeParams} {name}{parameters}".Trim();

        // Detect extension methods
        if (node.Modifiers.Any(m => m.IsKind(SyntaxKind.StaticKeyword))
            && node.ParameterList?.Parameters.Count > 0
            && node.ParameterList.Parameters[0].Modifiers.Any(m => m.IsKind(SyntaxKind.ThisKeyword)))
        {
            sym.Kind = "EXTENSION_METHOD";
            sym.Metadata["isExtension"] = true;
        }

        // Detect async/task
        if (node.Modifiers.Any(m => m.IsKind(SyntaxKind.AsyncKeyword)))
            sym.Metadata["isAsync"] = true;

        // Register parameter types for receiver resolution
        foreach (var p in node.ParameterList?.Parameters ?? new SeparatedSyntaxList<ParameterSyntax>())
        {
            var ptype = ExtractSimpleName(p.Type?.ToString() ?? "");
            if (!string.IsNullOrEmpty(ptype))
                _scopeTypes[p.Identifier.Text] = (ptype, "parameter");
        }

        // Set parent class from current scope
        if (_currentParentId != null)
            sym.ParentClass = _currentParentId.Split("::").LastOrDefault();

        ExtractAttributes(node.AttributeLists, sym);

        if (name == "ConfigureServices" || name == "Configure")
            sym.Kind = "CONFIG";

        Symbols.Add(sym);

        // Return, parameter and constraint types are usages of this method.
        var methodLine = LineOf(node);
        RecordTypeNode(sym.Id, node.ReturnType, methodLine, "return");
        foreach (var parameter in node.ParameterList?.Parameters ?? new SeparatedSyntaxList<ParameterSyntax>())
            RecordTypeNode(sym.Id, parameter.Type, LineOf(parameter), "parameter");
        foreach (var constraint in node.ConstraintClauses)
            foreach (var typeConstraint in constraint.Constraints.OfType<TypeConstraintSyntax>())
                RecordTypeNode(sym.Id, typeConstraint.Type, LineOf(typeConstraint), "constraint");

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        // Extract method calls from body (with receiver resolution).
        // Expression-bodied members (`=> Send(...)`) have no BlockSyntax —
        // their ExpressionBody carries the invocations.
        SyntaxNode? callScope = node.Body != null ? node.Body : node.ExpressionBody;
        ExtractMethodCalls(callScope, sym.Id, CollectLocals(node.Body));

        // Walk the body with this method as the referencing context — object
        // creations inside it become INSTANTIATES edges attributed to it.
        var previousCaller = _currentCallerId;
        _currentCallerId = sym.Id;
        base.VisitMethodDeclaration(node);
        _currentCallerId = previousCaller;
    }

    public override void VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        // Use .ctor suffix to avoid ID collision with the class itself, and
        // name the symbol "X.ctor" so find_references/find_symbol by name
        // never confuse the constructor with the type it constructs.
        var ctorId = MakeId($"{name}.ctor");
        var sym = MakeMemberSymbol($"{name}.ctor", "CONSTRUCTOR", node, ctorId);
        var parameters = node.ParameterList?.ToString() ?? "()";
        sym.Signature = $"{name}{parameters}";
        Symbols.Add(sym);

        foreach (var parameter in node.ParameterList?.Parameters ?? new SeparatedSyntaxList<ParameterSyntax>())
            RecordTypeNode(sym.Id, parameter.Type, LineOf(parameter), "parameter");

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        foreach (var p in node.ParameterList?.Parameters ?? new SeparatedSyntaxList<ParameterSyntax>())
        {
            var ptype = ExtractSimpleName(p.Type?.ToString() ?? "");
            if (!string.IsNullOrEmpty(ptype))
                _scopeTypes[p.Identifier.Text] = (ptype, "parameter");
        }

        SyntaxNode? callScope = node.Body != null ? node.Body : node.ExpressionBody;
        ExtractMethodCalls(callScope, sym.Id, CollectLocals(node.Body));

        // Walk the body with this constructor as the referencing context.
        var previousCaller = _currentCallerId;
        _currentCallerId = sym.Id;
        base.VisitConstructorDeclaration(node);
        _currentCallerId = previousCaller;
    }

    public override void VisitDestructorDeclaration(DestructorDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeMemberSymbol($"~{name}", "DESTRUCTOR", node, MakeId($"~{name}"));
        Symbols.Add(sym);
        base.VisitDestructorDeclaration(node);
    }

    public override void VisitPropertyDeclaration(PropertyDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeMemberSymbol(name, "PROPERTY", node, MakeId(name));
        var returnType = node.Type.ToString();
        sym.Signature = $"{returnType} {name} {{ get; set; }}";

        // Auto-property detection
        if (node.AccessorList?.Accessors.All(a => a.Body == null && a.ExpressionBody == null) == true)
            sym.Metadata["isAutoProperty"] = true;

        ExtractAttributes(node.AttributeLists, sym);
        Symbols.Add(sym);

        RecordTypeNode(sym.Id, node.Type, LineOf(node), "declaration");

        _scopeTypes[name] = (ExtractSimpleName(node.Type.ToString()), "property");

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        base.VisitPropertyDeclaration(node);
    }

    public override void VisitFieldDeclaration(FieldDeclarationSyntax node)
    {
        var returnType = node.Declaration.Type.ToString();
        foreach (var variable in node.Declaration.Variables)
        {
            var name = variable.Identifier.Text;
            var sym = MakeMemberSymbol(name, "FIELD", node, MakeId(name));
            sym.Signature = $"{returnType} {name}";
            sym.Metadata["isPublic"] = node.Modifiers.Any(m => m.IsKind(SyntaxKind.PublicKeyword));
            sym.Metadata["isStatic"] = node.Modifiers.Any(m => m.IsKind(SyntaxKind.StaticKeyword));
            sym.Metadata["isReadonly"] = node.Modifiers.Any(m => m.IsKind(SyntaxKind.ReadOnlyKeyword));
            sym.Metadata["isConst"] = node.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword));

            if (sym.Metadata["isConst"] is true)
                sym.Kind = "CONSTANT";

            Symbols.Add(sym);
            if (_currentParentId != null)
                Relationships.Add(MakeContains(_currentParentId, sym.Id));

            RecordTypeNode(sym.Id, node.Declaration.Type, LineOf(node), "declaration");

            // Track the field's type for receiver resolution (skip `var`)
            var fieldType = ExtractSimpleName(node.Declaration.Type.ToString());
            if (fieldType != "var")
                _scopeTypes[name] = (fieldType, "field");
        }
        base.VisitFieldDeclaration(node);
    }

    public override void VisitEventDeclaration(EventDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeMemberSymbol(name, "EVENT", node, MakeId(name));
        sym.Signature = $"event {node.Type} {name}";
        Symbols.Add(sym);

        RecordTypeNode(sym.Id, node.Type, LineOf(node), "declaration");

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        base.VisitEventDeclaration(node);
    }

    public override void VisitEventFieldDeclaration(EventFieldDeclarationSyntax node)
    {
        foreach (var variable in node.Declaration.Variables)
        {
            var name = variable.Identifier.Text;
            var sym = MakeMemberSymbol(name, "EVENT", node, MakeId(name));
            sym.Signature = $"event {node.Declaration.Type} {name}";
            Symbols.Add(sym);

            RecordTypeNode(sym.Id, node.Declaration.Type, LineOf(node), "declaration");

            if (_currentParentId != null)
                Relationships.Add(MakeContains(_currentParentId, sym.Id));
        }
        base.VisitEventFieldDeclaration(node);
    }

    // ============================================================
    // Object creation — INSTANTIATES edges
    // ============================================================

    public override void VisitObjectCreationExpression(ObjectCreationExpressionSyntax node)
    {
        // `new X(...)` — record an INSTANTIATES edge from the innermost member
        // (or its containing type, for field/property initializers) to X.
        // This is what makes find_references(X) answer "who instantiates X".
        var typeName = ExtractSimpleName(node.Type.ToString());
        var callerId = _currentCallerId ?? _currentParentId;

        if (!string.IsNullOrEmpty(typeName) && callerId != null)
        {
            // Same-file type → exact target ID. Otherwise a tentative ID that
            // the cross-file resolver rewrites against the symbol table.
            var targetId = _declaredTypeIds.TryGetValue(typeName, out var knownId)
                ? knownId
                : MakeId(typeName);

            Relationships.Add(new BridgeRelationship
            {
                Id = $"{callerId}|instantiates|{targetId}",
                SourceSymbolId = callerId,
                TargetSymbolId = targetId,
                Kind = "INSTANTIATES",
                Metadata = new Dictionary<string, object?> { ["typeName"] = typeName }
            });
        }

        // Also a type usage (and the only way to reach generic arguments of
        // `new List<ProfileDto>()`). Same line as INSTANTIATES — find_references
        // merges lines, so the occurrence is counted once.
        RecordTypeNode(callerId, node.Type, LineOf(node), "new");

        base.VisitObjectCreationExpression(node);
    }

    // ============================================================
    // Type usages — USES_TYPE edges
    //
    // Data types (DTOs, records, entities) are mentioned far more often than
    // they are instantiated or called: declarations, generic arguments, casts,
    // typeof, is/as, patterns and static member access. Without these edges
    // find_references(Dto) only saw `new Dto()` and reported a fraction of the
    // real usages.
    // ============================================================

    public override void VisitLocalDeclarationStatement(LocalDeclarationStatementSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Declaration.Type, LineOf(node), "local");
        base.VisitLocalDeclarationStatement(node);
    }

    public override void VisitForStatement(ForStatementSyntax node)
    {
        if (node.Declaration != null)
            RecordTypeNode(_currentCallerId, node.Declaration.Type, LineOf(node), "local");
        base.VisitForStatement(node);
    }

    public override void VisitForEachStatement(ForEachStatementSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "local");
        base.VisitForEachStatement(node);
    }

    public override void VisitCatchDeclaration(CatchDeclarationSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "catch");
        base.VisitCatchDeclaration(node);
    }

    public override void VisitTypeOfExpression(TypeOfExpressionSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "typeof");
        base.VisitTypeOfExpression(node);
    }

    public override void VisitCastExpression(CastExpressionSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "cast");
        base.VisitCastExpression(node);
    }

    public override void VisitBinaryExpression(BinaryExpressionSyntax node)
    {
        if ((node.IsKind(SyntaxKind.IsExpression) || node.IsKind(SyntaxKind.AsExpression))
            && node.Right is TypeSyntax rightType)
        {
            RecordTypeNode(_currentCallerId, rightType, LineOf(node),
                node.IsKind(SyntaxKind.IsExpression) ? "is" : "as");
        }
        base.VisitBinaryExpression(node);
    }

    public override void VisitDeclarationPattern(DeclarationPatternSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "pattern");
        base.VisitDeclarationPattern(node);
    }

    public override void VisitTypePattern(TypePatternSyntax node)
    {
        RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "pattern");
        base.VisitTypePattern(node);
    }

    public override void VisitRecursivePattern(RecursivePatternSyntax node)
    {
        if (node.Type != null)
            RecordTypeNode(_currentCallerId, node.Type, LineOf(node), "pattern");
        base.VisitRecursivePattern(node);
    }

    public override void VisitMemberAccessExpression(MemberAccessExpressionSyntax node)
    {
        // `X.Member` where X is a type (static access, const, enum member) is a
        // usage of X that never produces a call edge.
        if (node.Expression is IdentifierNameSyntax receiver && IsTypeReceiver(receiver.Identifier.Text))
            RecordTypeUsage(_currentCallerId, receiver.Identifier.Text, LineOf(node), "member");
        base.VisitMemberAccessExpression(node);
    }

    public override void VisitInvocationExpression(InvocationExpressionSyntax node)
    {
        // nameof(X) mentions the type by name.
        if (node.Expression is IdentifierNameSyntax identifier && identifier.Identifier.Text == "nameof"
            && node.ArgumentList.Arguments.Count > 0
            && node.ArgumentList.Arguments[0].Expression is IdentifierNameSyntax argument)
        {
            RecordTypeUsage(_currentCallerId, argument.Identifier.Text, LineOf(node), "nameof");
        }

        // Generic method calls: Array.Empty<Dto>(), cache.GetOrAdd<Dto>(...).
        var generic = node.Expression as GenericNameSyntax
            ?? (node.Expression as MemberAccessExpressionSyntax)?.Name as GenericNameSyntax;
        if (generic != null)
        {
            foreach (var typeArgument in generic.TypeArgumentList.Arguments)
                RecordTypeNode(_currentCallerId, typeArgument, LineOf(node), "generic");
        }

        base.VisitInvocationExpression(node);
    }

    public override void VisitLocalFunctionStatement(LocalFunctionStatementSyntax node)
    {
        // Local functions have no symbol of their own; their signature usage is
        // attributed to the enclosing member.
        RecordTypeNode(_currentCallerId, node.ReturnType, LineOf(node), "return");
        foreach (var parameter in node.ParameterList.Parameters)
            RecordTypeNode(_currentCallerId, parameter.Type, LineOf(parameter), "parameter");
        base.VisitLocalFunctionStatement(node);
    }

    // ============================================================
    // Top-level: using directives, global statements
    // ============================================================

    public override void VisitUsingDirective(UsingDirectiveSyntax node)
    {
        var importPath = node.Name?.ToString() ?? "";
        if (string.IsNullOrEmpty(importPath)) return;

        // `using MyApp.Models;` makes that namespace visible. Aliases and
        // `using static` point at a type/member, so record their parent
        // namespace — `Alias.Type` references still resolve with it.
        if (node.Alias != null || node.StaticKeyword.IsKind(SyntaxKind.StaticKeyword))
        {
            var lastDot = importPath.LastIndexOf('.');
            if (lastDot > 0) _usingNamespaces.Add(importPath[..lastDot]);
        }
        else
        {
            _usingNamespaces.Add(importPath);
        }

        var sourceId = MakeId($"import:{importPath}");
        var targetId = MakeId(importPath);
        Relationships.Add(new BridgeRelationship
        {
            Id = $"{sourceId}|imports|{targetId}",
            SourceSymbolId = sourceId,
            TargetSymbolId = targetId,
            Kind = "IMPORTS",
            Metadata = new Dictionary<string, object?> { ["importPath"] = importPath }
        });
        base.VisitUsingDirective(node);
    }

    // ============================================================
    // Helpers
    // ============================================================

    private BridgeSymbol MakeSymbol(string name, string kind, SyntaxNode node)
    {
        return MakeSymbolWithId(name, kind, node, MakeId(name));
    }

    private BridgeSymbol MakeMemberSymbol(string name, string kind, SyntaxNode node, string id)
    {
        return MakeSymbolWithId(name, kind, node, id);
    }

    private BridgeSymbol MakeSymbolWithId(string name, string kind, SyntaxNode node, string id)
    {
        var span = node.GetLocation().GetLineSpan();
        // Compute namespace: if inside a parent type, use its full name as namespace
        string ns;
        if (_currentParentId != null && kind != "CLASS" && kind != "INTERFACE" && kind != "STRUCT" && kind != "ENUM")
        {
            var parentName = _currentParentId.Split("::").LastOrDefault() ?? "";
            ns = parentName;
        }
        else
        {
            ns = _currentNamespace;
        }
        var fullName = string.IsNullOrEmpty(ns) ? name : $"{ns}.{name}";

        // Get doc comment from trivia
        string? docComment = null;
        var trivia = node.GetLeadingTrivia();
        foreach (var t in trivia)
        {
            if (t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) ||
                t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia))
            {
                docComment = t.ToString().Trim();
            }
        }

        var snippet = node.ToString();
        var hash = ComputeHash(snippet);

        var location = new LocationInfo
        {
            Repository = _repo,
            RelativePath = _relPath,
            StartLine = span.StartLinePosition.Line + 1,
            EndLine = span.EndLinePosition.Line + 1,
            StartColumn = span.StartLinePosition.Character,
            EndColumn = span.EndLinePosition.Character
        };

        return new BridgeSymbol
        {
            Id = id,
            Name = name,
            Kind = kind,
            Language = "csharp",
            Location = location,
            Namespace = ns,
            DocComment = docComment,
            SourceSnippet = snippet,
            ContentHash = hash,
            Metadata = new Dictionary<string, object?>
            {
                ["fullName"] = fullName,
                ["isPublic"] = node.ChildTokens().Any(t => t.IsKind(SyntaxKind.PublicKeyword))
            }
        };
    }

    private string MakeId(string name)
    {
        var ns = ScopedNamespacePrefix;
        return $"{_repo}::{_relPath}::{ns}{name}";
    }

    /// <summary>
    /// Gets the current namespace prefix, including parent class scope.
    /// e.g. "MyApp.Services.PaymentService."
    /// </summary>
    private string ScopedNamespacePrefix
    {
        get
        {
            if (_currentParentId != null)
            {
                var parentName = _currentParentId.Split("::").LastOrDefault() ?? "";
                return string.IsNullOrEmpty(parentName) ? "" : $"{parentName}.";
            }
            return string.IsNullOrEmpty(_currentNamespace) ? "" : $"{_currentNamespace}.";
        }
    }

    private BridgeRelationship MakeContains(string parentId, string childId)
    {
        return new BridgeRelationship
        {
            Id = $"{parentId}|contains|{childId}",
            SourceSymbolId = parentId,
            TargetSymbolId = childId,
            Kind = "CONTAINS"
        };
    }

    /// <summary>
    /// Extract method invocations from a method body and add CALLS relationships.
    /// The receiver expression is classified with a syntax-level type map
    /// (fields, properties, parameters, locals) so cross-class calls carry
    /// receiverType metadata for deterministic resolution downstream.
    /// </summary>
    private void ExtractMethodCalls(SyntaxNode? body, string callerId,
        Dictionary<string, (string Type, string Kind)>? methodLocals = null)
    {
        if (body == null) return;

        var invocations = body.DescendantNodes().OfType<InvocationExpressionSyntax>();
        foreach (var invocation in invocations)
        {
            string calledName;
            string? receiverType = null;
            string? receiverExpr = null;
            string? receiverKind = null;

            if (invocation.Expression is MemberAccessExpressionSyntax memberAccess)
            {
                calledName = ExtractSimpleName(memberAccess.Name.Identifier.Text);
                var recv = memberAccess.Expression;

                if (recv is IdentifierNameSyntax rid)
                {
                    var recvName = rid.Identifier.Text;
                    receiverExpr = recvName;
                    var scoped = LookupScopeType(recvName, methodLocals);
                    if (scoped.HasValue)
                    {
                        receiverType = scoped.Value.Type;
                        receiverKind = scoped.Value.Kind;
                    }
                    else if (_declaredTypes.Contains(recvName)
                        || (recvName.Length > 0 && char.IsUpper(recvName[0])))
                    {
                        // Static call on a type name (OrderValidator.Validate())
                        receiverType = recvName;
                        receiverKind = "type";
                    }
                }
                else if (recv is ThisExpressionSyntax)
                {
                    // Same class — the raw target is already scoped correctly.
                    receiverExpr = "this";
                    receiverKind = "this";
                }
                else if (recv is ObjectCreationExpressionSyntax oc)
                {
                    receiverType = ExtractSimpleName(oc.Type.ToString());
                    receiverExpr = $"new {receiverType}";
                    receiverKind = "constructor";
                }
                // Chained access (a.B().C()) or invocation results — type unknown,
                // leave metadata empty and rely on the name-based fallback.
            }
            else if (invocation.Expression is IdentifierNameSyntax identifier)
            {
                calledName = identifier.Identifier.Text;
            }
            else
            {
                continue;
            }

            if (calledName == "ToString" || calledName == "GetType" || calledName == "Equals"
                || calledName == "GetHashCode" || calledName == "Dispose" || calledName == "DisposeAsync"
                || calledName == "nameof")
                continue;

            var targetId = MakeId(calledName);
            var rel = new BridgeRelationship
            {
                Id = $"{callerId}|calls|{targetId}",
                SourceSymbolId = callerId,
                TargetSymbolId = targetId,
                Kind = "CALLS"
            };

            if (receiverType != null)
            {
                rel.Metadata["receiverType"] = receiverType;
                rel.Metadata["receiverExpr"] = receiverExpr;
                rel.Metadata["receiverKind"] = receiverKind;
            }
            else if (receiverExpr != null)
            {
                rel.Metadata["receiverExpr"] = receiverExpr;
                if (receiverKind != null)
                    rel.Metadata["receiverKind"] = receiverKind;
            }

            Relationships.Add(rel);
        }
    }

    /// <summary>
    /// Local variables with explicit types (skip `var`) — their type is known
    /// syntactically and helps resolve `dto.Map()`-style receivers.
    /// </summary>
    private static Dictionary<string, (string Type, string Kind)> CollectLocals(BlockSyntax? body)
    {
        var locals = new Dictionary<string, (string Type, string Kind)>();
        if (body == null) return locals;

        foreach (var local in body.DescendantNodes().OfType<LocalDeclarationStatementSyntax>())
        {
            var typeName = ExtractSimpleName(local.Declaration.Type.ToString());
            if (typeName == "var") continue;
            foreach (var v in local.Declaration.Variables)
                locals[v.Identifier.Text] = (typeName, "local");
        }
        return locals;
    }

    private (string Type, string Kind)? LookupScopeType(
        string name,
        Dictionary<string, (string Type, string Kind)>? methodLocals)
    {
        if (methodLocals != null && methodLocals.TryGetValue(name, out var local))
            return local;
        if (_scopeTypes.TryGetValue(name, out var scoped))
            return scoped;
        return null;
    }

    private void DetectConvention(BridgeSymbol sym, string name)
    {
        var isTest = _relPath.Contains("Test")
            || _relPath.Contains("Tests")
            || name.EndsWith("Tests")
            || name.EndsWith("Test");

        var originalKind = sym.Kind;

        switch (name)
        {
            case var n when n.EndsWith("Controller"):
                sym.Kind = "CONTROLLER"; break;
            case var n when n.EndsWith("Service"):
                sym.Kind = "SERVICE"; break;
            case var n when n.EndsWith("Repository"):
                sym.Kind = "REPOSITORY"; break;
            case var n when n.EndsWith("DTO") || n.EndsWith("Dto"):
                sym.Kind = "DTO"; break;
            case var n when n.EndsWith("Entity") || n.EndsWith("Model"):
                sym.Kind = "ENTITY"; break;
            case var n when n.EndsWith("Middleware"):
                sym.Kind = "MIDDLEWARE"; break;
            case var n when n.EndsWith("Handler"):
                sym.Kind = "CONTROLLER"; break;
            case var n when n.EndsWith("Factory"):
                sym.Kind = "FACTORY"; break;
            case var n when n.EndsWith("Validator"):
                sym.Kind = "VALIDATOR"; break;
            case var n when n.EndsWith("Exception"):
                sym.Kind = "EXCEPTION"; break;
            case var n when n.EndsWith("Provider"):
                sym.Kind = "PROVIDER"; break;
            case var n when n.EndsWith("Options"):
                sym.Kind = "CONFIG"; break;
        }

        if (isTest)
        {
            sym.Kind = "TEST";
            sym.Metadata["isTest"] = true;
        }

        if (sym.Kind != originalKind)
            sym.Metadata["detectedByConvention"] = true;
    }

    private void ExtractAttributes(SyntaxList<AttributeListSyntax> attributeLists, BridgeSymbol sym)
    {
        foreach (var attrList in attributeLists)
        {
            foreach (var attr in attrList.Attributes)
            {
                var attrName = attr.Name.ToString();
                sym.Metadata[$"attribute:{attrName}"] = true;

                // ASP.NET route attributes
                if (attrName.StartsWith("Http"))
                {
                    sym.Metadata["isRoute"] = true;
                    if (attr.ArgumentList?.Arguments.Count > 0)
                    {
                        var route = attr.ArgumentList.Arguments[0].ToString().Trim('"', '\'');
                        sym.Metadata["route"] = route;
                    }
                }

                if (attrName is "ApiControllerAttribute" or "ApiController")
                    sym.Metadata["isApiController"] = true;
                if (attrName is "FromBodyAttribute" or "FromBody")
                    sym.Metadata["fromBody"] = true;
                if (attrName is "FromQueryAttribute" or "FromQuery")
                    sym.Metadata["fromQuery"] = true;
                if (attrName is "FromRouteAttribute" or "FromRoute")
                    sym.Metadata["fromRoute"] = true;
                if (attrName is "AuthorizeAttribute" or "Authorize")
                    sym.Metadata["requiresAuth"] = true;
                if (attrName is "AllowAnonymousAttribute" or "AllowAnonymous")
                    sym.Metadata["allowAnonymous"] = true;
            }
        }
    }

    // ============================================================
    // Type usage helpers
    // ============================================================

    private static int LineOf(SyntaxNode node) =>
        node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

    /** Record every type mentioned by a type syntax (generics included). */
    private void RecordTypeNode(string? callerId, TypeSyntax? type, int line, string kind)
    {
        if (type == null) return;
        var names = new HashSet<string>(StringComparer.Ordinal);
        CollectTypeNames(type, names);
        foreach (var name in names)
            RecordTypeUsage(callerId, name, line, kind);
    }

    private void RecordTypeUsage(string? callerId, string? typeName, int line, string kind)
    {
        var caller = callerId ?? _currentParentId;
        if (caller == null || string.IsNullOrEmpty(typeName)) return;
        if (IsBuiltinType(typeName)) return;

        var key = (caller, typeName);
        if (!_typeUsages.TryGetValue(key, out var usage))
        {
            usage = new TypeUsage { Namespace = _currentNamespace };
            _typeUsages[key] = usage;
        }
        usage.Lines.Add(line);
        usage.Kinds.Add(kind);
    }

    /** A type used as a receiver (`X.Member`) is not a variable/field in scope. */
    private bool IsTypeReceiver(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        if (_declaredTypes.Contains(name)) return true;
        if (_scopeTypes.ContainsKey(name)) return false;
        return char.IsUpper(name[0]);
    }

    /**
     * Materialize collected type usages as USES_TYPE edges. Called once after
     * the file is walked: each usage keeps the namespace that was in effect at
     * its own line, not the last namespace of the file.
     */
    public void FlushTypeUsages()
    {
        var usings = _usingNamespaces.OrderBy(u => u, StringComparer.Ordinal).ToList();

        foreach (var entry in _typeUsages)
        {
            var (callerId, typeName) = entry.Key;
            var usage = entry.Value;
            var targetId = _declaredTypeIds.TryGetValue(typeName, out var knownId)
                ? knownId
                : MakeTentativeTypeId(typeName, usage.Namespace);

            Relationships.Add(new BridgeRelationship
            {
                Id = $"{callerId}|uses_type|{targetId}",
                SourceSymbolId = callerId,
                TargetSymbolId = targetId,
                Kind = "USES_TYPE",
                Metadata = new Dictionary<string, object?>
                {
                    ["typeName"] = typeName,
                    ["namespace"] = usage.Namespace,
                    ["usings"] = usings,
                    ["lines"] = usage.Lines.ToList(),
                    ["count"] = usage.Lines.Count,
                    ["usageKinds"] = usage.Kinds.ToList(),
                },
            });
        }
    }

    /** ID for a type declared in another file — resolved later by the symbol table. */
    private string MakeTentativeTypeId(string typeName, string ns)
    {
        var prefix = string.IsNullOrEmpty(ns) ? "" : $"{ns}.";
        return $"{_repo}::{_relPath}::{prefix}{typeName}";
    }

    /**
     * Collect simple type names from a type syntax, including generic arguments:
     * `Dictionary<string, List<ProfileDto>>` → ProfileDto (BCL names are filtered
     * at record time). Qualified names keep only the last segment.
     */
    private static void CollectTypeNames(TypeSyntax? type, ISet<string> sink)
    {
        switch (type)
        {
            case null:
            case PredefinedTypeSyntax:
            case OmittedTypeArgumentSyntax:
                return;
            case IdentifierNameSyntax identifier:
                sink.Add(identifier.Identifier.Text);
                return;
            case GenericNameSyntax generic:
                sink.Add(generic.Identifier.Text);
                foreach (var argument in generic.TypeArgumentList.Arguments)
                    CollectTypeNames(argument, sink);
                return;
            case QualifiedNameSyntax qualified:
                CollectTypeNames(qualified.Right, sink);
                return;
            case AliasQualifiedNameSyntax alias:
                CollectTypeNames(alias.Name, sink);
                return;
            case ArrayTypeSyntax array:
                CollectTypeNames(array.ElementType, sink);
                return;
            case NullableTypeSyntax nullable:
                CollectTypeNames(nullable.ElementType, sink);
                return;
            case PointerTypeSyntax pointer:
                CollectTypeNames(pointer.ElementType, sink);
                return;
            case RefTypeSyntax reference:
                CollectTypeNames(reference.Type, sink);
                return;
            case TupleTypeSyntax tuple:
                foreach (var element in tuple.Elements)
                    CollectTypeNames(element.Type, sink);
                return;
            case FunctionPointerTypeSyntax functionPointer:
                // Roslyn exposes the return type as the last parameter of the list.
                foreach (var parameter in functionPointer.ParameterList.Parameters)
                    CollectTypeNames(parameter.Type, sink);
                return;
            default:
                var simple = ExtractSimpleName(type.ToString());
                if (!string.IsNullOrEmpty(simple)) sink.Add(simple);
                return;
        }
    }

    /**
     * Primitives and BCL types that can never be a repo type. Filtering them
     * here keeps the unresolved-relationship buffer small: every USES_TYPE edge
     * whose target does not exist in the symbol table is retried on each flush.
     */
    private static bool IsBuiltinType(string name) => BuiltinTypeNames.Contains(name);

    private static readonly HashSet<string> BuiltinTypeNames = new(StringComparer.Ordinal)
    {
        // Primitives
        "bool", "byte", "sbyte", "char", "decimal", "double", "float", "int",
        "uint", "long", "ulong", "short", "ushort", "object", "string", "void",
        "var", "dynamic", "nint", "nuint",
        // BCL containers and framework types
        "Action", "Array", "Comparer", "Console", "Convert", "DateTime",
        "DateTimeOffset", "Debug", "Dictionary", "Directory", "Enumerable",
        "Environment", "EqualityComparer", "Exception", "File", "Func", "Guid",
        "HashSet", "IAsyncEnumerable", "ICollection", "IComparable", "IDictionary",
        "IDisposable", "IEnumerable", "IEquatable", "IList", "IReadOnlyCollection",
        "IReadOnlyDictionary", "IReadOnlyList", "ISet", "KeyValuePair", "Lazy",
        "List", "Math", "Memory", "Nullable", "Path", "Predicate", "Queryable",
        "ReadOnlyMemory", "ReadOnlySpan", "Regex", "Span", "String", "Task",
        "TimeSpan", "Tuple", "ValueTask",
    };

    /// <summary>
    /// Extract the simple name from a potentially generic-qualified type name.
    /// "List<int>" → "List", "Dictionary<string, int>" → "Dictionary"
    /// </summary>
    private static string ExtractSimpleName(string typeName)
    {
        var bracketIdx = typeName.IndexOf('<');
        var withoutGenerics = bracketIdx > 0 ? typeName[..bracketIdx] : typeName;
        var lastDot = withoutGenerics.LastIndexOf('.');
        return lastDot > 0 ? withoutGenerics[(lastDot + 1)..] : withoutGenerics;
    }

    private static string ComputeHash(string input)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        var hash = _sha.ComputeHash(bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
