using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Text.Json;
using System.Text.Json.Serialization;

// ============================================================
// YATS C# Bridge — analyzes C# source files via Roslyn
// ============================================================

if (args.Length < 2 || args[0] != "--file" || args.Length < 4 || args[2] != "--repo")
{
    Console.Error.WriteLine("Usage: dotnet run -- --file <path> --repo <name>");
    Environment.Exit(1);
}

var filePath = args[1];
var repoName = args[3];

if (!File.Exists(filePath))
{
    Console.Error.WriteLine($"File not found: {filePath}");
    Environment.Exit(1);
}

var code = File.ReadAllText(filePath);
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
// Analyzer
// ============================================================

public class CSharpAnalyzer : CSharpSyntaxWalker
{
    private readonly string _repo;
    private readonly string _filePath;
    private readonly string _relPath;
    private string _currentNamespace = "";

    public List<BridgeSymbol> Symbols { get; } = new();
    public List<BridgeRelationship> Relationships { get; } = new();

    public CSharpAnalyzer(string repo, string filePath)
    {
        _repo = repo;
        _filePath = filePath;
        _relPath = Path.GetFileName(filePath);
    }

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

    public override void VisitClassDeclaration(ClassDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "class", node);
        DetectConvention(sym, name);

        // Base class
        if (node.BaseList != null)
        {
            foreach (var baseType in node.BaseList.Types)
            {
                var baseName = baseType.Type.ToString();
                var baseId = MakeId(baseName);
                Relationships.Add(new BridgeRelationship
                {
                    Id = $"{sym.Id}|inherits|{baseId}",
                    SourceSymbolId = sym.Id,
                    TargetSymbolId = baseId,
                    Kind = baseName.StartsWith("I") ? "implements" : "inherits"
                });
            }
        }

        // Attributes
        ExtractAttributes(node.AttributeLists, sym);

        Symbols.Add(sym);
        base.VisitClassDeclaration(node);
    }

    public override void VisitInterfaceDeclaration(InterfaceDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "interface", node);
        Symbols.Add(sym);
        base.VisitInterfaceDeclaration(node);
    }

    public override void VisitEnumDeclaration(EnumDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "enum", node);
        Symbols.Add(sym);
        base.VisitEnumDeclaration(node);
    }

    public override void VisitStructDeclaration(StructDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "struct", node);
        Symbols.Add(sym);
        base.VisitStructDeclaration(node);
    }

    public override void VisitRecordDeclaration(RecordDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var kind = node.Kind() == SyntaxKind.RecordStructDeclaration ? "struct" : "class";
        var sym = MakeSymbol(name, kind, node);
        sym.Metadata["isRecord"] = true;
        Symbols.Add(sym);
        base.VisitRecordDeclaration(node);
    }

    public override void VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "method", node);
        sym.Signature = node.ToString().Split('{')[0].Trim();

        // Find parent class
        var parent = node.Ancestors().OfType<ClassDeclarationSyntax>().FirstOrDefault()
                  ?? node.Ancestors().OfType<StructDeclarationSyntax>().FirstOrDefault()
                  ?? node.Ancestors().OfType<RecordDeclarationSyntax>().FirstOrDefault() as MemberDeclarationSyntax;

        if (parent is ClassDeclarationSyntax cls)
            sym.ParentClass = cls.Identifier.Text;
        else if (parent is StructDeclarationSyntax stc)
            sym.ParentClass = stc.Identifier.Text;

        sym.Namespace = sym.ParentClass != null
            ? $"{_currentNamespace}.{sym.ParentClass}"
            : _currentNamespace;

        ExtractAttributes(node.AttributeLists, sym);

        if (name == "ConfigureServices" || name == "Configure")
            sym.Kind = "config";

        Symbols.Add(sym);
        base.VisitMethodDeclaration(node);
    }

    public override void VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "constructor", node);
        Symbols.Add(sym);
        base.VisitConstructorDeclaration(node);
    }

    public override void VisitPropertyDeclaration(PropertyDeclarationSyntax node)
    {
        var name = node.Identifier.Text;
        var sym = MakeSymbol(name, "property", node);
        Symbols.Add(sym);
        base.VisitPropertyDeclaration(node);
    }

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
            Kind = "imports",
            Metadata = new Dictionary<string, object?> { ["importPath"] = importPath }
        });
        base.VisitUsingDirective(node);
    }

    // ============================================================
    // Helpers
    // ============================================================

    private BridgeSymbol MakeSymbol(string name, string kind, SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        var lineSpan = node.GetLocation().GetMappedLineSpan();
        var fullName = string.IsNullOrEmpty(_currentNamespace)
            ? name
            : $"{_currentNamespace}.{name}";

        // Get doc comment from trivia
        var docComment = "";
        var trivia = node.GetLeadingTrivia();
        foreach (var t in trivia)
        {
            if (t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) ||
                t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia))
            {
                docComment = t.ToString().Trim();
            }
        }

        return new BridgeSymbol
        {
            Id = MakeId(name),
            Name = name,
            Kind = kind,
            Language = "csharp",
            Location = new LocationInfo
            {
                Repository = _repo,
                RelativePath = _relPath,
                StartLine = span.StartLinePosition.Line + 1,
                EndLine = span.EndLinePosition.Line + 1,
                StartColumn = span.StartLinePosition.Character,
                EndColumn = span.EndLinePosition.Character
            },
            Namespace = _currentNamespace,
            DocComment = string.IsNullOrEmpty(docComment) ? null : docComment,
            SourceSnippet = node.ToString().Length > 500 ? node.ToString()[..500] : node.ToString(),
            Metadata = new Dictionary<string, object?>
            {
                ["fullName"] = fullName,
                ["isPublic"] = node.ChildTokens().Any(t => t.IsKind(SyntaxKind.PublicKeyword))
            }
        };
    }

    private string MakeId(string name)
    {
        var ns = string.IsNullOrEmpty(_currentNamespace) ? "" : $"{_currentNamespace}.";
        return $"{_repo}::{_relPath}::{ns}{name}";
    }

    private void DetectConvention(BridgeSymbol sym, string name)
    {
        var isTest = _relPath.Contains("Test")
            || _relPath.Contains("Tests")
            || name.EndsWith("Tests")
            || name.EndsWith("Test");

        switch (name)
        {
            case var n when n.EndsWith("Controller"):
                sym.Kind = "controller"; break;
            case var n when n.EndsWith("Service"):
                sym.Kind = "service"; break;
            case var n when n.EndsWith("Repository"):
                sym.Kind = "repository"; break;
            case var n when n.EndsWith("DTO") || n.EndsWith("Dto"):
                sym.Kind = "dto"; break;
            case var n when n.EndsWith("Entity") || n.EndsWith("Model"):
                sym.Kind = "entity"; break;
            case var n when n.EndsWith("Middleware"):
                sym.Kind = "middleware"; break;
            case var n when n.EndsWith("Handler"):
                sym.Kind = "controller"; break;
            case var n when n.EndsWith("Factory"):
                sym.Kind = "factory"; break;
        }

        if (isTest) sym.Kind = "test";
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
                    sym.Kind = "route";
                    if (attr.ArgumentList?.Arguments.Count > 0)
                    {
                        var route = attr.ArgumentList.Arguments[0].ToString().Trim('"', '\'');
                        sym.Metadata["route"] = route;
                    }
                }

                if (attrName == "ApiControllerAttribute" || attrName == "ApiController")
                    sym.Metadata["isApiController"] = true;
            }
        }
    }
}
