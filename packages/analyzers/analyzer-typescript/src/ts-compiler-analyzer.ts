import ts from "typescript";
import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult, AnalysisError } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent } from "@yats/shared";
import { createSymbolId } from "@yats/shared";

// ============================================================
// TypeScript Compiler API Analyzer
// ============================================================

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export class TypeScriptAnalyzer extends AbstractAnalyzer {
  readonly language = Language.TYPESCRIPT;

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase();
    return ext ? TS_EXTENSIONS.has(`.${ext}`) : false;
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const errors: AnalysisError[] = [];
    const warnings: AnalysisError[] = [];

    try {
      // Create a virtual source file
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        ts.ScriptKind.TSX,
      );

      // Extract symbols by walking the AST
      this.extractSymbols(
        sourceFile,
        filePath,
        content,
        repositoryName,
        symbols,
        relationships,
      );

      // Detect architectural conventions
      this.detectConventions(
        sourceFile,
        filePath,
        repositoryName,
        symbols,
        relationships,
      );

    } catch (err: any) {
      errors.push({
        line: 1,
        column: 0,
        message: `Parse error: ${err.message}`,
        severity: "error",
      });
    }

    return { symbols, relationships, errors, warnings };
  }

  // ============================================================
  // Symbol Extraction
  // ============================================================

  private extractSymbols(
    sourceFile: ts.SourceFile,
    filePath: string,
    content: string,
    repository: string,
    symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    const namespace = this.getNamespace(sourceFile);

    // Walk all statements
    ts.forEachChild(sourceFile, (node) => {
      this.processNode(
        node,
        sourceFile,
        filePath,
        content,
        repository,
        namespace,
        null,
        symbols,
        relationships,
      );
    });
  }

  private processNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string,
    content: string,
    repository: string,
    namespace: string,
    parentId: string | null,
    symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    const startPos = node.getStart(sourceFile);
    const { line: startLine, character: startCol } =
      sourceFile.getLineAndCharacterOfPosition(startPos);
    const endPos = node.getEnd();
    const { line: endLine, character: endCol } =
      sourceFile.getLineAndCharacterOfPosition(endPos);

    const text = content.slice(startPos, endPos);
    const id = createSymbolId(repository, filePath, this.getNodePath(node, sourceFile, namespace));

    if (ts.isClassDeclaration(node) && node.name) {
      const sym = this.createSymbol({
        id,
        name: node.name.text,
        kind: SymbolKind.CLASS,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      });
      symbols.push(sym);

      if (parentId) {
        relationships.push(
          this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
        );
      }

      // Check heritage (extends, implements) — do this BEFORE processing
      // members so that errors in member processing don't skip heritage extraction
      this.extractHeritage(node, sourceFile, id, filePath, repository, namespace, symbols, relationships);

      // Process class members
      ts.forEachChild(node, (member) => {
        this.processClassMember(
          member,
          sourceFile,
          filePath,
          content,
          repository,
          namespace,
          id,
          node.name!.text,
          symbols,
          relationships,
        );
      });
    }

    // Interface
    else if (ts.isInterfaceDeclaration(node) && node.name) {
      const sym = this.createSymbol({
        id,
        name: node.name.text,
        kind: SymbolKind.INTERFACE,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      });
      symbols.push(sym);

      if (parentId) {
        relationships.push(
          this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
        );
      }

      // Process interface members
      ts.forEachChild(node, (member) => {
        this.processClassMember(
          member,
          sourceFile,
          filePath,
          content,
          repository,
          namespace,
          id,
          node.name!.text,
          symbols,
          relationships,
        );
      });
    }

    // Enum
    else if (ts.isEnumDeclaration(node) && node.name) {
      symbols.push(this.createSymbol({
        id,
        name: node.name.text,
        kind: SymbolKind.ENUM,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      }));
    }

    // Function declaration
    else if (ts.isFunctionDeclaration(node) && node.name) {
      const sig = this.getSignature(node, sourceFile, content);
      symbols.push(this.createSymbol({
        id,
        name: node.name.text,
        kind: SymbolKind.FUNCTION,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        signature: sig,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      }));

      if (parentId) {
        relationships.push(
          this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
        );
      }

      // Extract calls from function body
      this.extractCalls(node, sourceFile, id, filePath, repository, namespace, symbols, relationships);
    }

    // Variable statement
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const varId = createSymbolId(repository, filePath, `${namespace}.${decl.name.text}`);
          symbols.push(this.createSymbol({
            id: varId,
            name: decl.name.text,
            kind: SymbolKind.VARIABLE,
            language: this.language,
            repository,
            relativePath: filePath,
            namespace,
            startLine: startLine + 1,
            endLine: endLine + 1,
            startColumn: startCol,
            endColumn: endCol,
            sourceSnippet: text.slice(0, 500),
            contentHash: hashContent(text),
          }));
        }
      }
    }

    // Type alias
    else if (ts.isTypeAliasDeclaration(node) && node.name) {
      symbols.push(this.createSymbol({
        id,
        name: node.name.text,
        kind: SymbolKind.TYPE_ALIAS,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 1000),
        contentHash: hashContent(text),
      }));
    }

    // Import/Export declarations
    else if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral)?.text;
      if (moduleSpecifier) {
        this.extractImport(node, sourceFile, filePath, repository, moduleSpecifier, id, relationships);
        // Don't recurse into imports — they refer to other files
        return;
      }
    }
    else if (ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier
        ? (node.moduleSpecifier as ts.StringLiteral)?.text
        : null;
      if (moduleSpecifier) {
        this.extractExport(node, filePath, repository, moduleSpecifier, id, relationships);
        return;
      }
    }

    // Recurse into child nodes
    ts.forEachChild(node, (child) => {
      this.processNode(
        child,
        sourceFile,
        filePath,
        content,
        repository,
        namespace,
        parentId,
        symbols,
        relationships,
      );
    });
  }

  private processClassMember(
    member: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string,
    content: string,
    repository: string,
    namespace: string,
    parentId: string,
    parentName: string,
    symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    const startPos = member.getStart(sourceFile);
    const { line: startLine, character: startCol } =
      sourceFile.getLineAndCharacterOfPosition(startPos);
    const endPos = member.getEnd();
    const { line: endLine, character: endCol } =
      sourceFile.getLineAndCharacterOfPosition(endPos);
    const text = content.slice(startPos, endPos);

    // Method
    if (ts.isMethodDeclaration(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const id = createSymbolId(repository, filePath, `${namespace}.${parentName}.${name}`);
      const sig = this.getSignature(member, sourceFile, content);

      symbols.push(this.createSymbol({
        id,
        name,
        kind: SymbolKind.METHOD,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        parentClass: parentName,
        signature: sig,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      }));

      relationships.push(
        this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
      );

      // Extract calls from method body
      this.extractCalls(member, sourceFile, id, filePath, repository, namespace, symbols, relationships);
    }

    // Constructor
    else if (ts.isConstructorDeclaration(member)) {
      const id = createSymbolId(repository, filePath, `${namespace}.${parentName}.constructor`);
      symbols.push(this.createSymbol({
        id,
        name: "constructor",
        kind: SymbolKind.CONSTRUCTOR,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        parentClass: parentName,
        signature: this.getSignature(member, sourceFile, content),
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 2000),
        contentHash: hashContent(text),
      }));

      relationships.push(
        this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
      );

      this.extractCalls(member, sourceFile, id, filePath, repository, namespace, symbols, relationships);
    }

    // Property
    else if (ts.isPropertyDeclaration(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const id = createSymbolId(repository, filePath, `${namespace}.${parentName}.${name}`);

      symbols.push(this.createSymbol({
        id,
        name,
        kind: SymbolKind.PROPERTY,
        language: this.language,
        repository,
        relativePath: filePath,
        namespace,
        parentClass: parentName,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        sourceSnippet: text.slice(0, 500),
        contentHash: hashContent(text),
      }));

      relationships.push(
        this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
      );
    }

    // Getter/Setter
    else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
      if (member.name) {
        const prefix = ts.isGetAccessor(member) ? "get " : "set ";
        const name = member.name.getText(sourceFile);
        const id = createSymbolId(repository, filePath, `${namespace}.${parentName}.${prefix}${name}`);

        symbols.push(this.createSymbol({
          id,
          name: `${prefix}${name}`,
          kind: SymbolKind.METHOD,
          language: this.language,
          repository,
          relativePath: filePath,
          namespace,
          parentClass: parentName,
          startLine: startLine + 1,
          endLine: endLine + 1,
          startColumn: startCol,
          endColumn: endCol,
          sourceSnippet: text.slice(0, 500),
          contentHash: hashContent(text),
        }));

        relationships.push(
          this.createRelationship(parentId, id, RelationshipKind.CONTAINS),
        );
      }
    }

    // Decorators
    ts.forEachChild(member, (child) => {
      if (ts.isDecorator(child)) {
        const decoratorText = child.getText(sourceFile);
        const decoratorName = child.expression.getText(sourceFile).split("(")[0];
        const decId = createSymbolId(repository, filePath, `${namespace}.${parentName}.@${decoratorName}${Math.random().toString(36).slice(2, 8)}`);

        symbols.push(this.createSymbol({
          id: decId,
          name: decoratorText,
          kind: SymbolKind.DECORATOR,
          language: this.language,
          repository,
          relativePath: filePath,
          namespace,
          parentClass: parentName,
          startLine: startLine + 1,
          endLine: startLine + 1,
          startColumn: startCol,
          endColumn: startCol + decoratorText.length,
          sourceSnippet: decoratorText,
          contentHash: hashContent(decoratorText),
        }));

        relationships.push(
          this.createRelationship(decId, parentId, RelationshipKind.DECORATES),
        );
      }
    });
  }

  // ============================================================
  // Heritage: Extends & Implements
  // ============================================================

  private extractHeritage(
    node: ts.ClassDeclaration | ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile,
    classId: string,
    filePath: string,
    repository: string,
    namespace: string,
    _symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    // Check extends
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          const typeName = type.expression.getText(sourceFile);
          const targetId = createSymbolId(repository, filePath, `${namespace}.${typeName}`);

          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            relationships.push(
              this.createRelationship(classId, targetId, RelationshipKind.INHERITS),
            );
          } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
            relationships.push(
              this.createRelationship(classId, targetId, RelationshipKind.IMPLEMENTS),
            );
          }
        }
      }
    }
  }

  // ============================================================
  // Call Extraction
  // ============================================================

  private extractCalls(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    callerId: string,
    filePath: string,
    repository: string,
    namespace: string,
    symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    const visitCall = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) {
        const callee = child.expression;
        const calleeText = callee.getText(sourceFile);
        // Skip console.log, etc. but capture useful calls
        if (
          calleeText.includes(".") ||
          calleeText.includes("(")
        ) {
          // Simple heuristic: extract the last part of a dotted expression
          const parts = calleeText.split("(")[0]!.split(".");
          const methodName = parts[parts.length - 1]!;
          const objectPath = parts.slice(0, -1).join(".");

          const calleeId = objectPath
            ? createSymbolId(repository, filePath, `${namespace}.${objectPath}.${methodName}`)
            : createSymbolId(repository, filePath, `${namespace}.${methodName}`);

          relationships.push(
            this.createRelationship(callerId, calleeId, RelationshipKind.CALLS),
          );
        }
      }
      ts.forEachChild(child, visitCall);
    };

    ts.forEachChild(node, visitCall);
  }

  // ============================================================
  // Import/Export Extraction
  // ============================================================

  private extractImport(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    repository: string,
    moduleSpecifier: string,
    _id: string,
    relationships: Relationship[],
  ): void {
    if (node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;
      if (ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.name.text;
          const targetId = createSymbolId(
            repository,
            moduleSpecifier,
            importedName,
          );
          const sourceId = createSymbolId(
            repository,
            filePath,
            importedName,
          );
          relationships.push(
            this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS),
          );
        }
      } else if (ts.isNamespaceImport(bindings)) {
        const nsName = bindings.name.text;
        const sourceId = createSymbolId(repository, filePath, nsName);
        const targetId = createSymbolId(repository, moduleSpecifier, "*");
        relationships.push(
          this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS),
        );
      }
    }

    // Default import
    if (node.importClause?.name) {
      const defaultName = node.importClause.name.text;
      const sourceId = createSymbolId(repository, filePath, defaultName);
      const targetId = createSymbolId(repository, moduleSpecifier, "default");
      relationships.push(
        this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS),
      );
    }
  }

  private extractExport(
    node: ts.ExportDeclaration,
    filePath: string,
    repository: string,
    moduleSpecifier: string,
    _id: string,
    relationships: Relationship[],
  ): void {
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const exportedName = element.name.text;
        const sourceId = createSymbolId(repository, filePath, exportedName);
        const targetId = createSymbolId(repository, moduleSpecifier, exportedName);
        relationships.push(
          this.createRelationship(sourceId, targetId, RelationshipKind.EXPORTS),
        );
      }
    }
  }

  // ============================================================
  // Convention Detection
  // ============================================================

  private detectConventions(
    sourceFile: ts.SourceFile,
    filePath: string,
    repository: string,
    symbols: Symbol[],
    relationships: Relationship[],
  ): void {
    const isTestFile =
      filePath.includes(".test.") ||
      filePath.includes(".spec.") ||
      filePath.includes("__tests__") ||
      filePath.includes("/test/") ||
      filePath.includes("/tests/");

    const isConfigFile =
      filePath.includes(".config.") ||
      filePath.includes("config/") ||
      filePath.endsWith(".config.ts");

    if (isTestFile) {
      for (const sym of symbols) {
        sym.kind = SymbolKind.TEST;
        sym.metadata["isTest"] = true;
      }
    }

    if (isConfigFile) {
      for (const sym of symbols) {
        if (sym.kind === SymbolKind.VARIABLE || sym.kind === SymbolKind.CLASS) {
          sym.kind = SymbolKind.CONFIG;
          sym.metadata["isConfig"] = true;
        }
      }
    }

    // Detect architectural patterns by class name suffix
    for (const sym of symbols) {
      if (sym.kind !== SymbolKind.CLASS) continue;

      const name = sym.name;
      let detectedKind: SymbolKind | null = null;

      if (name.endsWith("Controller")) detectedKind = SymbolKind.CONTROLLER;
      else if (name.endsWith("Service")) detectedKind = SymbolKind.SERVICE;
      else if (name.endsWith("Repository")) detectedKind = SymbolKind.REPOSITORY;
      else if (name.endsWith("Dto") || name.endsWith("DTO")) detectedKind = SymbolKind.DTO;
      else if (name.endsWith("Entity") || name.endsWith("Model")) detectedKind = SymbolKind.ENTITY;
      else if (name.endsWith("Command")) detectedKind = SymbolKind.COMMAND;
      else if (name.endsWith("Query")) detectedKind = SymbolKind.QUERY;
      else if (name.endsWith("Event")) detectedKind = SymbolKind.EVENT;
      else if (name.endsWith("Middleware")) detectedKind = SymbolKind.MIDDLEWARE;
      else if (name.endsWith("Guard")) detectedKind = SymbolKind.GUARD;
      else if (name.endsWith("Interceptor")) detectedKind = SymbolKind.INTERCEPTOR;
      else if (name.endsWith("Factory")) detectedKind = SymbolKind.FACTORY;
      else if (name.endsWith("Provider")) detectedKind = SymbolKind.PROVIDER;
      else if (name.endsWith("Component")) detectedKind = SymbolKind.COMPONENT;

      if (detectedKind) {
        sym.kind = detectedKind;
        sym.metadata["detectedByConvention"] = true;
      }
    }

    // Detect decorator-based conventions
    this.visitDecorators(sourceFile, (decoratorName, parentNode) => {
      const containingClass = this.findContainingClass(parentNode, sourceFile);
      if (!containingClass) return;

      const matchingSymbol = symbols.find(
        (s) => s.name === containingClass && s.kind === SymbolKind.CLASS,
      );
      if (!matchingSymbol) return;

      const decoLower = decoratorName.toLowerCase();

      if (decoLower === "controller" || decoLower.includes("controller")) {
        matchingSymbol.kind = SymbolKind.CONTROLLER;
        matchingSymbol.metadata["framework"] = "nestjs";
      } else if (decoLower === "injectable") {
        matchingSymbol.kind = SymbolKind.SERVICE;
        matchingSymbol.metadata["framework"] = "nestjs";
      } else if (decoLower === "module") {
        matchingSymbol.kind = SymbolKind.MODULE;
        matchingSymbol.metadata["framework"] = "nestjs";
      } else if (decoLower === "entity") {
        matchingSymbol.kind = SymbolKind.ENTITY;
        matchingSymbol.metadata["framework"] = "typeorm";
      } else if (
        decoLower === "get" ||
        decoLower === "post" ||
        decoLower === "put" ||
        decoLower === "patch" ||
        decoLower === "delete"
      ) {
        matchingSymbol.kind = SymbolKind.ROUTE;
        matchingSymbol.metadata["httpMethod"] = decoratorName.toUpperCase();
      }
    });
  }

  private visitDecorators(
    sourceFile: ts.SourceFile,
    visitor: (decoratorName: string, parent: ts.Node) => void,
  ): void {
    const visit = (node: ts.Node): void => {
      if (ts.isDecorator(node)) {
        const name = node.expression.getText(sourceFile).split("(")[0]!;
        visitor(name, node.parent);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  private findContainingClass(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): string | null {
    let current: ts.Node | undefined = node;
    while (current) {
      if (
        ts.isClassDeclaration(current) &&
        current.name
      ) {
        return current.name.text;
      }
      current = current.parent;
    }
    return null;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private getNamespace(sourceFile: ts.SourceFile): string {
    // Use the file path as the namespace
    const filePath = sourceFile.fileName;
    const withoutExt = filePath.replace(/\.(ts|tsx|mts|cts)$/, "");
    return withoutExt.replace(/\//g, ".");
  }

  private getNodePath(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    namespace: string,
  ): string {
    if (ts.isClassDeclaration(node) && node.name) {
      return `${namespace}.${node.name.text}`;
    }
    if (ts.isInterfaceDeclaration(node) && node.name) {
      return `${namespace}.${node.name.text}`;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      return `${namespace}.${node.name.text}`;
    }
    if (ts.isEnumDeclaration(node) && node.name) {
      return `${namespace}.${node.name.text}`;
    }
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      return `${namespace}.${node.name.text}`;
    }
    return `${namespace}.${ts.SyntaxKind[node.kind]}`;
  }

  private getSignature(
    node: ts.FunctionLikeDeclaration,
    sourceFile: ts.SourceFile,
    _content: string,
  ): string {
    const name =
      ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)
        ? node.name?.getText(sourceFile) ?? "anonymous"
        : "constructor";

    const params = node.parameters.map((p) => p.getText(sourceFile)).join(", ");
    const returnType = node.type?.getText(sourceFile) ?? "void";

    // Check if async
    const isAsync = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
    );
    const prefix = isAsync ? "async " : "";

    return `${prefix}${name}(${params}): ${returnType}`;
  }
}
