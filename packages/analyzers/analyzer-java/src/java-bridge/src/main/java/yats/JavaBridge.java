package yats;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.PackageDeclaration;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.resolution.declarations.ResolvedReferenceTypeDeclaration;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.Collectors;

/**
 * YATS Java Bridge — analyzes Java files via JavaParser + JavaSymbolSolver.
 *
 * Usage: java -jar yats-java-bridge.jar --file <path> --repo <name> [--stdin]
 * Reads the file content from stdin when --stdin is given (the path is then
 * used only for IDs). Emits {symbols, relationships, errors, warnings} as JSON.
 */
public class JavaBridge {

    private final String repo;
    private final String filePath;
    private final String packageName;
    private final List<Map<String, Object>> symbols = new ArrayList<>();
    private final List<Map<String, Object>> relationships = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        String file = null, repo = null;
        boolean stdin = false;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--file" -> file = args[++i];
                case "--repo" -> repo = args[++i];
                case "--stdin" -> stdin = true;
            }
        }
        if (file == null || repo == null) {
            System.err.println("Usage: java -jar yats-java-bridge.jar --file <path> --repo <name> [--stdin]");
            System.exit(1);
        }
        String code;
        if (stdin) {
            code = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        } else {
            code = Files.readString(Path.of(file), StandardCharsets.UTF_8);
        }

        Map<String, Object> out;
        try {
            JavaBridge bridge = new JavaBridge(repo, file);
            out = bridge.analyze(code);
        } catch (Exception e) {
            out = new LinkedHashMap<>();
            out.put("symbols", List.of());
            out.put("relationships", List.of());
            out.put("errors", List.of(Map.of(
                    "line", 1, "column", 0, "message", e.getMessage(), "severity", "error")));
            out.put("warnings", List.of());
        }
        System.out.println(toJson(out));
    }

    private JavaBridge(String repo, String filePath) {
        this.repo = repo;
        this.filePath = filePath;
        this.packageName = "";
    }

    private Map<String, Object> analyze(String code) {
        ParserConfiguration config = new ParserConfiguration()
                .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_17);
        CombinedTypeSolver solver = new CombinedTypeSolver(new ReflectionTypeSolver());
        config.setSymbolResolver(new JavaSymbolSolver(solver));

        JavaParser parser = new JavaParser(config);
        ParseResult<CompilationUnit> parsed = parser.parse(code);
        CompilationUnit cu = parsed.getResult()
                .orElseThrow(() -> new RuntimeException("Failed to parse Java file"));
        String pkg = cu.getPackageDeclaration()
                .map(PackageDeclaration::getNameAsString)
                .orElse("");

        List<Map<String, Object>> errors = new ArrayList<>();
        parsed.getProblems().forEach(p ->
                errors.add(Map.of(
                        "line", p.getLocation()
                                .flatMap(l -> l.getBegin().getRange())
                                .map(r -> r.begin.line).orElse(1),
                        "column", p.getLocation()
                                .flatMap(l -> l.getBegin().getRange())
                                .map(r -> r.begin.column).orElse(0),
                        "message", p.getMessage(),
                        "severity", "error")));

        for (TypeDeclaration<?> type : cu.getTypes()) {
            collectType(type, pkg);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("symbols", symbols);
        out.put("relationships", relationships);
        out.put("errors", errors);
        out.put("warnings", List.of());
        return out;
    }

    private void collectType(TypeDeclaration<?> type, String pkg) {
        String name = type.getNameAsString();
        String fqn = pkg.isEmpty() ? name : pkg + "." + name;
        String kind = typeKind(type);
        String id = makeId(fqn);
        Map<String, Object> metadata = new LinkedHashMap<>();
        if (type instanceof ClassOrInterfaceDeclaration c) {
            if (c.isAbstract()) metadata.put("isAbstract", true);
            if (c.isFinal()) metadata.put("isFinal", true);
        }

        symbols.add(baseSymbol(type, id, name, kind, pkg, null, signatureOf(type), metadata));
        detectConvention(symbols.get(symbols.size() - 1));

        // extends / implements
        if (type instanceof ClassOrInterfaceDeclaration c) {
            for (ClassOrInterfaceType ext : c.getExtendedTypes()) {
                relationships.add(rel(id, makeId(resolveName(ext)), "INHERITS"));
            }
            for (ClassOrInterfaceType impl : c.getImplementedTypes()) {
                relationships.add(rel(id, makeId(resolveName(impl)), "IMPLEMENTS"));
            }
        } else if (type instanceof RecordDeclaration r) {
            for (ClassOrInterfaceType impl : r.getImplementedTypes()) {
                relationships.add(rel(id, makeId(resolveName(impl)), "IMPLEMENTS"));
            }
        } else if (type instanceof EnumDeclaration e) {
            for (ClassOrInterfaceType impl : e.getImplementedTypes()) {
                relationships.add(rel(id, makeId(resolveName(impl)), "IMPLEMENTS"));
            }
        }

        // members
        for (BodyDeclaration<?> member : type.getMembers()) {
            collectMember(member, type, pkg, fqn, id);
        }
    }

    private void collectMember(BodyDeclaration<?> member, TypeDeclaration<?> parent,
                               String pkg, String parentFqn, String parentId) {
        if (member instanceof MethodDeclaration m) {
            String memberName = m.getNameAsString();
            String memberId = makeId(parentFqn + "." + memberName);
            symbols.add(baseSymbol(m, memberId, memberName, "method", pkg, parent.getNameAsString(),
                    signatureOf(m), Map.of()));
            relationships.add(rel(parentId, memberId, "CONTAINS"));
            collectCalls(m, memberId);
        } else if (member instanceof ConstructorDeclaration c) {
            String memberId = makeId(parentFqn + "." + parent.getNameAsString());
            symbols.add(baseSymbol(c, memberId, parent.getNameAsString(), "constructor", pkg,
                    parent.getNameAsString(), signatureOf(c), Map.of()));
            relationships.add(rel(parentId, memberId, "CONTAINS"));
            collectCalls(c, memberId);
        } else if (member instanceof FieldDeclaration f) {
            for (VariableDeclarator var : f.getVariables()) {
                String fieldName = var.getNameAsString();
                String memberId = makeId(parentFqn + "." + fieldName);
                symbols.add(baseSymbol(f, memberId, fieldName, "field", pkg,
                        parent.getNameAsString(), null, Map.of()));
                relationships.add(rel(parentId, memberId, "CONTAINS"));
            }
        } else if (member instanceof EnumConstantDeclaration ec) {
            String memberId = makeId(parentFqn + "." + ec.getNameAsString());
            symbols.add(baseSymbol(ec, memberId, ec.getNameAsString(), "constant", pkg,
                    parent.getNameAsString(), null, Map.of()));
            relationships.add(rel(parentId, memberId, "CONTAINS"));
        } else if (member instanceof TypeDeclaration<?> nested) {
            collectType(nested, parentFqn);
        }
    }

    private void collectCalls(Node scope, String callerId) {
        for (MethodCallExpr call : scope.findAll(MethodCallExpr.class)) {
            String callee = call.getNameAsString();
            String targetId = makeId(callee);
            Map<String, Object> meta = new LinkedHashMap<>();
            try {
                String resolved = call.resolve().getQualifiedSignature();
                meta.put("resolved", resolved);
                targetId = makeId(shortName(resolved));
            } catch (Exception ignored) {
                // unresolvable — keep name-based target
            }
            relationships.add(rel(callerId, targetId, "CALLS", meta));
        }
        for (ObjectCreationExpr call : scope.findAll(ObjectCreationExpr.class)) {
            String typeName = call.getTypeAsString();
            String shortName = shortName(typeName);
            Map<String, Object> meta = new LinkedHashMap<>();
            try {
                String resolved = call.resolve().getQualifiedSignature();
                meta.put("resolved", resolved);
                shortName = shortName(resolved);
            } catch (Exception ignored) {
                // unresolvable
            }
            relationships.add(rel(callerId, makeId(shortName), "CALLS", meta));
        }
        // imports: file-level edge to the imported type
    }

    // ============================================================
    // Helpers
    // ============================================================

    private String typeKind(TypeDeclaration<?> t) {
        if (t instanceof AnnotationDeclaration) return "annotation";
        if (t instanceof ClassOrInterfaceDeclaration c) return c.isInterface() ? "interface" : "class";
        if (t instanceof EnumDeclaration) return "enum";
        if (t instanceof RecordDeclaration) return "record";
        return "class";
    }

    private String resolveName(ClassOrInterfaceType t) {
        try {
            com.github.javaparser.resolution.types.ResolvedType r = t.resolve();
            if (r.isReferenceType()) {
                return r.asReferenceType().getQualifiedName();
            }
            return t.getNameAsString();
        } catch (Exception e) {
            return t.getNameAsString();
        }
    }

    private String shortName(String qualified) {
        String q = qualified;
        int paren = q.indexOf('(');
        if (paren > 0) q = q.substring(0, paren);
        int lastDot = q.lastIndexOf('.');
        return lastDot >= 0 ? q.substring(lastDot + 1) : q;
    }

    private String signatureOf(Node n) {
        if (n instanceof CallableDeclaration<?> c) {
            return c.getDeclarationAsString(false, false, false)
                    .replaceAll("\\s*\\{.*$", "")
                    .replaceAll("\\s+", " ").trim();
        }
        return null;
    }

    private String makeId(String symbolPath) {
        return repo + "::" + filePath + "::" + symbolPath;
    }

    private Map<String, Object> baseSymbol(Node node, String id, String name, String kind,
                                           String namespace, String parentClass,
                                           String signature, Map<String, Object> metadata) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("id", id);
        s.put("name", name);
        s.put("kind", kind);
        s.put("language", "java");
        s.put("location", locationOf(node));
        s.put("namespace", namespace);
        s.put("parentClass", parentClass);
        s.put("signature", signature);
        s.put("docComment", node.getComment().map(c -> c.getContent()).orElse(null));
        s.put("sourceSnippet", snippetOf(node));
        s.put("contentHash", sha256(snippetOf(node)));
        s.put("metadata", metadata);
        return s;
    }

    private Map<String, Object> locationOf(Node node) {
        Map<String, Object> loc = new LinkedHashMap<>();
        var range = node.getRange();
        loc.put("repository", repo);
        loc.put("relativePath", filePath);
        loc.put("startLine", range.map(r -> r.begin.line).orElse(1));
        loc.put("endLine", range.map(r -> r.end.line).orElse(1));
        loc.put("startColumn", range.map(r -> r.begin.column).orElse(0));
        loc.put("endColumn", range.map(r -> r.end.column).orElse(0));
        return loc;
    }

    private String snippetOf(Node node) {
        try {
            String s = node.toString();
            return s.length() > 2000 ? s.substring(0, 2000) : s;
        } catch (Exception e) {
            return "";
        }
    }

    private void detectConvention(Map<String, Object> symbol) {
        String kind = (String) symbol.get("kind");
        if (!"class".equals(kind) && !"interface".equals(kind)) return;
        String name = (String) symbol.get("name");
        String path = filePath;
        boolean isTest = path.contains("/test/") || name.endsWith("Test") || name.endsWith("Tests");
        if (name.endsWith("Controller")) symbol.put("kind", "controller");
        else if (name.endsWith("Service")) symbol.put("kind", "service");
        else if (name.endsWith("Repository")) symbol.put("kind", "repository");
        else if (name.endsWith("DTO") || name.endsWith("Dto")) symbol.put("kind", "dto");
        else if (name.endsWith("Entity") || name.endsWith("Model")) symbol.put("kind", "entity");
        else if (name.endsWith("Command")) symbol.put("kind", "command");
        else if (name.endsWith("Event")) symbol.put("kind", "event");
        else if (name.endsWith("Listener")) symbol.put("kind", "event");
        else if (name.endsWith("Middleware")) symbol.put("kind", "middleware");
        else if (name.endsWith("Factory")) symbol.put("kind", "factory");
        if (isTest) {
            symbol.put("kind", "test");
            @SuppressWarnings("unchecked")
            Map<String, Object> meta = (Map<String, Object>) symbol.get("metadata");
            meta.put("isTest", true);
        }
    }

    private Map<String, Object> rel(String sourceId, String targetId, String kind) {
        return rel(sourceId, targetId, kind, Map.of());
    }

    private Map<String, Object> rel(String sourceId, String targetId, String kind,
                                    Map<String, Object> metadata) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", sourceId + "--[" + kind + "]-->" + targetId);
        r.put("sourceSymbolId", sourceId);
        r.put("targetSymbolId", targetId);
        r.put("kind", kind);
        r.put("metadata", metadata);
        return r;
    }

    private String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static String toJson(Object o) {
        // minimal JSON serializer (no runtime deps needed beyond JavaParser)
        if (o == null) return "null";
        if (o instanceof String s) {
            return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
        }
        if (o instanceof Number || o instanceof Boolean) return o.toString();
        if (o instanceof Map<?, ?> m) {
            return "{" + m.entrySet().stream()
                    .map(e -> "\"" + e.getKey() + "\":" + toJson(e.getValue()))
                    .collect(Collectors.joining(",")) + "}";
        }
        if (o instanceof Iterable<?> it) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : it) {
                if (!first) sb.append(",");
                sb.append(toJson(item));
                first = false;
            }
            return sb.append("]").toString();
        }
        return "null";
    }
}
