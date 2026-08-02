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

    public List<BridgeSymbol> Symbols { get; } = new();
    public List<BridgeRelationship> Relationships { get; } = new();

    private static readonly SHA256 _sha = SHA256.Create();

    public CSharpAnalyzer(string repo, string filePath)
    {
        _repo = repo;
        _filePath = filePath;
        _relPath = Path.GetFileName(filePath);
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

        // Track parent for CONTAINS
        var previousParent = _currentParentId;
        _currentParentId = sym.Id;

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
    }

    public override void VisitInterfaceDeclaration(InterfaceDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "INTERFACE", node);

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;

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
    }

    public override void VisitEnumDeclaration(EnumDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "ENUM", node);

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

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;

        ExtractAttributes(node.AttributeLists, sym);
        Symbols.Add(sym);
        base.VisitStructDeclaration(node);

        _currentParentId = previousParent;
    }

    public override void VisitRecordDeclaration(RecordDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var kind = node.Kind() == SyntaxKind.RecordStructDeclaration ? "STRUCT" : "CLASS";
        var sym = MakeSymbol(name, kind, node);
        sym.Metadata["isRecord"] = true;

        var previousParent = _currentParentId;
        _currentParentId = sym.Id;

        Symbols.Add(sym);
        base.VisitRecordDeclaration(node);

        _currentParentId = previousParent;
    }

    public override void VisitDelegateDeclaration(DelegateDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "DELEGATE", node);
        sym.Signature = node.ToString().Split('{', ';')[0].Trim();
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

        // Set parent class from current scope
        if (_currentParentId != null)
            sym.ParentClass = _currentParentId.Split("::").LastOrDefault();

        ExtractAttributes(node.AttributeLists, sym);

        if (name == "ConfigureServices" || name == "Configure")
            sym.Kind = "CONFIG";

        Symbols.Add(sym);

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        // Extract method calls from body
        ExtractMethodCalls(node.Body, sym.Id);

        base.VisitMethodDeclaration(node);
    }

    public override void VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        // Use .ctor suffix to avoid ID collision with the class itself
        var ctorId = MakeId($"{name}.ctor");
        var sym = MakeMemberSymbol(name, "CONSTRUCTOR", node, ctorId);
        var parameters = node.ParameterList?.ToString() ?? "()";
        sym.Signature = $"{name}{parameters}";
        Symbols.Add(sym);

        if (_currentParentId != null)
            Relationships.Add(MakeContains(_currentParentId, sym.Id));

        ExtractMethodCalls(node.Body, sym.Id);
        base.VisitConstructorDeclaration(node);
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
        }
        base.VisitFieldDeclaration(node);
    }

    public override void VisitEventDeclaration(EventDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeMemberSymbol(name, "EVENT", node, MakeId(name));
        sym.Signature = $"event {node.Type} {name}";
        Symbols.Add(sym);

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

            if (_currentParentId != null)
                Relationships.Add(MakeContains(_currentParentId, sym.Id));
        }
        base.VisitEventFieldDeclaration(node);
    }

    // ============================================================
    // Top-level: using directives, global statements
    // ============================================================

    public override void VisitUsingDirective(UsingDirectiveSyntax node)
    {
        var importPath = node.Name?.ToString() ?? "";
        if (string.IsNullOrEmpty(importPath)) return;

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
    /// </summary>
    private void ExtractMethodCalls(BlockSyntax? body, string callerId)
    {
        if (body == null) return;

        var invocations = body.DescendantNodes().OfType<InvocationExpressionSyntax>();
        foreach (var invocation in invocations)
        {
            string calledName;
            if (invocation.Expression is MemberAccessExpressionSyntax memberAccess)
                calledName = ExtractSimpleName(memberAccess.Name.Identifier.Text);
            else if (invocation.Expression is IdentifierNameSyntax identifier)
                calledName = identifier.Identifier.Text;
            else
                continue;

            if (calledName == "ToString" || calledName == "GetType" || calledName == "Equals"
                || calledName == "GetHashCode" || calledName == "Dispose" || calledName == "DisposeAsync")
                continue;

            var targetId = MakeId(calledName);
            Relationships.Add(new BridgeRelationship
            {
                Id = $"{callerId}|calls|{targetId}",
                SourceSymbolId = callerId,
                TargetSymbolId = targetId,
                Kind = "CALLS"
            });
        }
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
