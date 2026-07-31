#!/usr/bin/env php
<?php
/**
 * PHP Code Indexer Bridge
 * 
 * Analyzes PHP files using nikic/php-parser and PHPStan,
 * outputs a JSON representation of symbols and relationships.
 * 
 * Usage: php analyzer.php --file <path> [--repo <name>]
 *        php analyzer.php --dir <path> [--repo <name>]
 */

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;
use PhpParser\Error;

// ============================================================
// CLI Arguments
// ============================================================

$options = getopt('', ['file:', 'dir:', 'repo:', 'stdin']);
$repoName = $options['repo'] ?? basename(getcwd());
$useStdin = isset($options['stdin']);
$files = [];

if ($useStdin && isset($options['file'])) {
    // Read content from stdin, use --file path for ID generation only
    $files = [['path' => $options['file'], 'content' => stream_get_contents(STDIN)]];
} elseif (isset($options['file'])) {
    $files = [$options['file']];
} elseif (isset($options['dir'])) {
    $dir = $options['dir'];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS)
    );
    foreach ($iterator as $file) {
        if ($file->isFile() && preg_match('/\.php$/', $file->getFilename())) {
            $files[] = $file->getPathname();
        }
    }
} else {
    fwrite(STDERR, "Usage: php analyzer.php --file <path> [--repo <name>]\n");
    exit(1);
}

// ============================================================
// Symbol & Relationship Extraction
// ============================================================

function processFiles(array $files, string $repoName): array
{
    $parser = (new ParserFactory())->createForHostVersion();
    $allSymbols = [];
    $allRelationships = [];
    $allErrors = [];

    foreach ($files as $item) {
        try {
            if (is_array($item)) {
                $filePath = $item['path'];
                $code = $item['content'];
            } else {
                $filePath = $item;
                $code = file_get_contents($filePath);
            }
            if ($code === false || $code === '') continue;

            $ast = $parser->parse($code);
            if ($ast === null) continue;

            // Resolve names
            $traverser = new NodeTraverser();
            $traverser->addVisitor(new NameResolver());
            $ast = $traverser->traverse($ast);

            // Extract symbols
            $extractor = new SymbolExtractor($repoName, $filePath);
            $traverser = new NodeTraverser();
            $traverser->addVisitor($extractor);
            $traverser->traverse($ast);

            $symbols = $extractor->getSymbols();
            $relationships = $extractor->getRelationships();

            // Detect conventions
            $conventionDetector = new ConventionDetector($repoName, $filePath, $symbols, $relationships);
            $symbols = $conventionDetector->apply();

            $allSymbols = array_merge($allSymbols, $symbols);
            $allRelationships = array_merge($allRelationships, $relationships);

        } catch (Error $e) {
            $allErrors[] = [
                'line' => $e->getStartLine() ?? 1,
                'column' => $e->getStartColumn() ?? 0,
                'message' => $e->getMessage(),
                'severity' => 'error',
            ];
        }
    }

    return [$allSymbols, $allRelationships, $allErrors];
}

// ============================================================
// Class definitions below; main() runs at end of file
// ============================================================

// ============================================================
// Symbol Extractor Visitor
// ============================================================

class SymbolExtractor extends NodeVisitorAbstract
{
    private array $symbols = [];
    private array $relationships = [];
    private string $repo;
    private string $filePath;
    private string $namespace = '';
    private ?string $currentClass = null;

    public function __construct(string $repo, string $filePath)
    {
        $this->repo = $repo;
        $this->filePath = $filePath;
    }

    public function getSymbols(): array { return $this->symbols; }
    public function getRelationships(): array { return $this->relationships; }

    public function enterNode(Node $node)
    {
        // Namespace
        if ($node instanceof Node\Stmt\Namespace_ && $node->name) {
            $this->namespace = $node->name->toString();
        }

        // Class
        if ($node instanceof Node\Stmt\Class_ && $node->name) {
            $id = $this->makeId($node->name->toString());
            $symbol = $this->baseSymbol([
                'id' => $id,
                'name' => $node->name->toString(),
                'kind' => $node->isAbstract() ? 'interface_like' : 'class',
                'namespace' => $this->namespace,
            ], $node, 'class');

            if ($node->isAbstract()) {
                $symbol['metadata']['isAbstract'] = true;
            }
            if ($node->isFinal()) {
                $symbol['metadata']['isFinal'] = true;
            }
            if ($node->isReadonly()) {
                $symbol['metadata']['isReadonly'] = true;
            }

            $this->symbols[] = $symbol;
            $this->currentClass = $node->name->toString();

            // Extends
            if ($node->extends) {
                $targetId = $this->makeId($node->extends->toString());
                $this->relationships[] = [
                    'id' => "{$id}--[INHERITS]-->{$targetId}",
                    'sourceSymbolId' => $id,
                    'targetSymbolId' => $targetId,
                    'kind' => 'INHERITS',
                    'metadata' => [],
                ];
            }

            // Implements
            foreach ($node->implements as $iface) {
                $targetId = $this->makeId($iface->toString());
                $this->relationships[] = [
                    'id' => "{$id}--[IMPLEMENTS]-->{$targetId}",
                    'sourceSymbolId' => $id,
                    'targetSymbolId' => $targetId,
                    'kind' => 'IMPLEMENTS',
                    'metadata' => [],
                ];
            }
        }

        // Interface
        if ($node instanceof Node\Stmt\Interface_ && $node->name) {
            $id = $this->makeId($node->name->toString());
            $this->symbols[] = $this->baseSymbol([
                'id' => $id,
                'name' => $node->name->toString(),
                'kind' => 'interface',
                'namespace' => $this->namespace,
            ], $node, 'interface');

            $this->currentClass = $node->name->toString();

            foreach ($node->extends as $extended) {
                $targetId = $this->makeId($extended->toString());
                $this->relationships[] = [
                    'id' => "{$id}--[INHERITS]-->{$targetId}",
                    'sourceSymbolId' => $id,
                    'targetSymbolId' => $targetId,
                    'kind' => 'INHERITS',
                    'metadata' => [],
                ];
            }
        }

        // Trait
        if ($node instanceof Node\Stmt\Trait_ && $node->name) {
            $this->symbols[] = $this->baseSymbol([
                'id' => $this->makeId($node->name->toString()),
                'name' => $node->name->toString(),
                'kind' => 'class', // Traits are mapped to class
                'namespace' => $this->namespace,
            ], $node, 'trait');
        }

        // Enum
        if ($node instanceof Node\Stmt\Enum_ && $node->name) {
            $this->symbols[] = $this->baseSymbol([
                'id' => $this->makeId($node->name->toString()),
                'name' => $node->name->toString(),
                'kind' => 'enum',
                'namespace' => $this->namespace,
            ], $node, 'enum');
        }

        // Method
        if ($node instanceof Node\Stmt\ClassMethod && $this->currentClass) {
            $name = $node->name->toString();
            $id = $this->makeId($this->currentClass . '.' . $name);
            $parentId = $this->makeId($this->currentClass);

            $kind = strtolower($name) === '__construct' ? 'constructor' : 'method';

            $this->symbols[] = $this->baseSymbol([
                'id' => $id,
                'name' => $name,
                'kind' => $kind,
                'namespace' => $this->namespace,
                'parentClass' => $this->currentClass,
                'signature' => $this->getSignature($node),
            ], $node, 'method');

            $this->relationships[] = [
                'id' => "{$parentId}--[CONTAINS]-->{$id}",
                'sourceSymbolId' => $parentId,
                'targetSymbolId' => $id,
                'kind' => 'CONTAINS',
                'metadata' => [],
            ];

            $this->extractCalls($node, $id);
        }

        // Property
        if ($node instanceof Node\Stmt\Property && $this->currentClass) {
            foreach ($node->props as $prop) {
                $name = $prop->name->toString();
                $id = $this->makeId($this->currentClass . '.' . $name);
                $parentId = $this->makeId($this->currentClass);

                $this->symbols[] = $this->baseSymbol([
                    'id' => $id,
                    'name' => $name,
                    'kind' => 'property',
                    'namespace' => $this->namespace,
                    'parentClass' => $this->currentClass,
                ], $node, 'property');

                $this->relationships[] = [
                    'id' => "{$parentId}--[CONTAINS]-->{$id}",
                    'sourceSymbolId' => $parentId,
                    'targetSymbolId' => $id,
                    'kind' => 'CONTAINS',
                    'metadata' => [],
                ];
            }
        }

        // Class constant
        if ($node instanceof Node\Stmt\ClassConst && $this->currentClass) {
            foreach ($node->consts as $const) {
                $name = $const->name->toString();
                $id = $this->makeId($this->currentClass . '.' . $name);

                $this->symbols[] = $this->baseSymbol([
                    'id' => $id,
                    'name' => $name,
                    'kind' => 'constant',
                    'namespace' => $this->namespace,
                    'parentClass' => $this->currentClass,
                ], $node, 'constant');
            }
        }

        // Function (global)
        if ($node instanceof Node\Stmt\Function_ && !$this->currentClass) {
            $name = $node->name->toString();
            $id = $this->makeId($name);

            $this->symbols[] = $this->baseSymbol([
                'id' => $id,
                'name' => $name,
                'kind' => 'function',
                'namespace' => $this->namespace,
                'signature' => $this->getSignature($node),
            ], $node, 'function');
        }

        // Use statements (imports)
        if ($node instanceof Node\Stmt\Use_) {
            foreach ($node->uses as $use) {
                $importedName = $use->name->toString();
                $targetId = $this->makeId($importedName);
                $sourceId = $this->makeId('import:' . $importedName);

                // We create an IMPORTS relationship from the file to the imported symbol
                $fileNodeId = "{$this->repo}::{$this->filePath}::_file_";
                $this->relationships[] = [
                    'id' => "{$fileNodeId}--[IMPORTS]-->{$targetId}",
                    'sourceSymbolId' => $fileNodeId,
                    'targetSymbolId' => $targetId,
                    'kind' => 'IMPORTS',
                    'metadata' => ['alias' => $use->alias?->toString() ?? null],
                ];
            }
        }

        // Attributes (PHP 8+)
        if ($node instanceof Node\AttributeGroup) {
            foreach ($node->attrs as $attr) {
                $attrName = $attr->name->toString();
                $this->symbols[] = [
                    'id' => $this->makeId("@{$attrName}"),
                    'name' => "#[{$attrName}]",
                    'kind' => 'attribute',
                    'language' => 'php',
                    'location' => $this->makeLocation($node),
                    'namespace' => $this->namespace,
                    'parentClass' => $this->currentClass,
                    'signature' => null,
                    'docComment' => null,
                    'sourceSnippet' => "#[{$attrName}]",
                    'contentHash' => hash('sha256', "#[{$attrName}]"),
                    'metadata' => ['attributeName' => $attrName],
                ];
            }
        }
    }

    private function extractCalls(Node $node, string $callerId): void
    {
        $visitor = new class($callerId, $this->repo, $this->filePath) extends NodeVisitorAbstract {
            public function __construct(
                private string $callerId,
                private string $repo,
                private string $filePath,
                public array $calls = [],
            ) {}

            public function enterNode(Node $node)
            {
                if ($node instanceof Node\Expr\MethodCall) {
                    $calleeName = $node->name->name ?? null;
                    if ($calleeName && $node->var instanceof Node\Expr\Variable) {
                        $targetId = "{$this->repo}::{$this->filePath}::{$calleeName}";
                        $this->calls[] = [
                            'id' => "{$this->callerId}--[CALLS]-->{$targetId}",
                            'sourceSymbolId' => $this->callerId,
                            'targetSymbolId' => $targetId,
                            'kind' => 'CALLS',
                            'metadata' => [],
                        ];
                    }
                }
                if ($node instanceof Node\Expr\FuncCall && $node->name instanceof Node\Name) {
                    $funcName = $node->name->toString();
                    $targetId = "{$this->repo}::{$this->filePath}::{$funcName}";
                    $this->calls[] = [
                        'id' => "{$this->callerId}--[CALLS]-->{$targetId}",
                        'sourceSymbolId' => $this->callerId,
                        'targetSymbolId' => $targetId,
                        'kind' => 'CALLS',
                        'metadata' => [],
                    ];
                }
            }
        };

        $traverser = new NodeTraverser();
        $traverser->addVisitor($visitor);
        $traverser->traverse($node->stmts ?? [$node]);

        $this->relationships = array_merge($this->relationships, $visitor->calls);
    }

    private function makeId(string $symbolPath): string
    {
        return "{$this->repo}::{$this->filePath}::{$symbolPath}";
    }

    private function makeLocation(Node $node): array
    {
        return [
            'repository' => $this->repo,
            'relativePath' => $this->filePath,
            'startLine' => $node->getStartLine(),
            'endLine' => $node->getEndLine(),
            'startColumn' => $node->getStartFilePos(),
            'endColumn' => $node->getEndFilePos(),
        ];
    }

    private function baseSymbol(array $overrides, Node $node, string $kind): array
    {
        $text = $this->getNodeText($node);
        return array_merge([
            'language' => 'php',
            'location' => $this->makeLocation($node),
            'docComment' => $node->getDocComment()?->getText() ?? null,
            'sourceSnippet' => substr($text, 0, 2000),
            'contentHash' => hash('sha256', $text),
            'metadata' => [],
        ], $overrides);
    }

    private function getNodeText(Node $node): string
    {
        // Best-effort: use start/end positions
        return "{$node->getStartLine()}:{$node->getEndLine()}";
    }

    private function getSignature(Node\FunctionLike $node): string
    {
        $params = [];
        foreach ($node->getParams() as $param) {
            $typeStr = $param->type ? $this->typeToString($param->type) : '';
            $type = $typeStr ? $typeStr . ' ' : '';
            $byRef = $param->byRef ? '&' : '';
            $variadic = $param->variadic ? '...' : '';
            $default = $param->default ? ' = ...' : '';
            $params[] = "{$type}{$byRef}{$variadic}\${$param->var->name}{$default}";
        }

        $returnType = $node->getReturnType();
        $returnStr = $returnType ? ': ' . $this->typeToString($returnType) : '';

        $visibility = '';
        if ($node instanceof Node\Stmt\ClassMethod) {
            if ($node->isPublic()) $visibility = 'public ';
            elseif ($node->isProtected()) $visibility = 'protected ';
            elseif ($node->isPrivate()) $visibility = 'private ';
        }

        $static = $node->isStatic() ? 'static ' : '';
        $name = $node->name->toString() ?? 'anonymous';

        return "{$visibility}{$static}function {$name}(" . implode(', ', $params) . "){$returnStr}";
    }

    private function typeToString(PhpParser\Node $type): string
    {
        if ($type instanceof Node\Identifier) {
            return $type->toString();
        }
        if ($type instanceof Node\Name) {
            return $type->toString();
        }
        if ($type instanceof Node\NullableType) {
            return '?' . $this->typeToString($type->type);
        }
        if ($type instanceof Node\UnionType) {
            return implode('|', array_map(fn($t) => $this->typeToString($t), $type->types));
        }
        if ($type instanceof Node\IntersectionType) {
            return implode('&', array_map(fn($t) => $this->typeToString($t), $type->types));
        }
        return '';
    }
}

// ============================================================
// Convention Detector
// ============================================================

class ConventionDetector
{
    private string $repo;
    private string $filePath;
    private array $symbols;
    private array $relationships;

    public function __construct(string $repo, string $filePath, array $symbols, array $relationships)
    {
        $this->repo = $repo;
        $this->filePath = $filePath;
        $this->symbols = $symbols;
        $this->relationships = $relationships;
    }

    public function apply(): array
    {
        $isTestFile = preg_match('/(?:Test|TestCase)\.php$/', $this->filePath)
            || str_contains($this->filePath, '/tests/')
            || str_contains($this->filePath, '/test/');

        $isConfigFile = str_contains($this->filePath, '/config/')
            || preg_match('/\.config\.php$/', $this->filePath);

        foreach ($this->symbols as &$symbol) {
            if ($symbol['kind'] !== 'class' && $symbol['kind'] !== 'interface') continue;

            $name = $symbol['name'];

            // Symfony/Laravel conventions
            if (str_ends_with($name, 'Controller')) {
                $symbol['kind'] = 'controller';
                $symbol['metadata']['framework'] = 'laravel/symfony';
            } elseif (str_ends_with($name, 'Service')) {
                $symbol['kind'] = 'service';
            } elseif (str_ends_with($name, 'Repository')) {
                $symbol['kind'] = 'repository';
            } elseif (str_ends_with($name, 'DTO') || str_ends_with($name, 'Dto')) {
                $symbol['kind'] = 'dto';
            } elseif (str_ends_with($name, 'Entity') || str_ends_with($name, 'Model')) {
                $symbol['kind'] = 'entity';
                $symbol['metadata']['framework'] = 'doctrine/eloquent';
            } elseif (str_ends_with($name, 'Command')) {
                $symbol['kind'] = 'command';
                $symbol['metadata']['framework'] = 'symfony-console/laravel-artisan';
            } elseif (str_ends_with($name, 'Event')) {
                $symbol['kind'] = 'event';
            } elseif (str_ends_with($name, 'Listener') || str_ends_with($name, 'Subscriber')) {
                $symbol['kind'] = 'event';
            } elseif (str_ends_with($name, 'Middleware')) {
                $symbol['kind'] = 'middleware';
            } elseif (str_ends_with($name, 'Provider') || str_ends_with($name, 'ServiceProvider')) {
                $symbol['kind'] = 'provider';
                $symbol['metadata']['framework'] = 'laravel';
            } elseif (str_ends_with($name, 'Factory')) {
                $symbol['kind'] = 'factory';
            } elseif (str_ends_with($name, 'Migration')) {
                $symbol['kind'] = 'migration';
            }

            // Test detection
            if ($isTestFile) {
                $symbol['kind'] = 'test';
                $symbol['metadata']['isTest'] = true;
            }

            // Config detection
            if ($isConfigFile && $symbol['kind'] === 'class') {
                $symbol['kind'] = 'config';
                $symbol['metadata']['isConfig'] = true;
            }
        }

        return $this->symbols;
    }
}

// ============================================================
// Main
// ============================================================

[$allSymbols, $allRelationships, $allErrors] = processFiles($files, $repoName);

echo json_encode([
    'symbols' => $allSymbols,
    'relationships' => $allRelationships,
    'errors' => $allErrors,
    'warnings' => [],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
