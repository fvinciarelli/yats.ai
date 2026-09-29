import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PhpAnalyzer } from "./php-parser-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new PhpAnalyzer();

describe("PhpAnalyzer", () => {
  it("detects .php files", () => {
    assert.ok(analyzer.canAnalyze("index.php", ""));
    assert.ok(analyzer.canAnalyze("src/Controller.php", ""));
    assert.ok(!analyzer.canAnalyze("script.js", ""));
    assert.ok(!analyzer.canAnalyze("code.py", ""));
  });

  it("extracts classes with inheritance and interfaces", async () => {
    const code = `<?php

namespace App\\Services;

class PaymentService extends BaseService implements PaymentInterface
{
    public function process(float $amount): bool
    {
        return true;
    }
}
`;
    const result = await analyzer.analyze("PaymentService.php", code, "test-repo");

    // PaymentService is detected as SERVICE by naming convention
    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    assert.equal(services.length, 1);
    assert.equal(services[0]!.name, "PaymentService");

    const inherits = result.relationships.filter((r) => r.kind === RelationshipKind.INHERITS);
    const impls = result.relationships.filter((r) => r.kind === RelationshipKind.IMPLEMENTS);
    assert.equal(inherits.length, 1);
    assert.equal(impls.length, 1);
  });

  it("extracts interfaces", async () => {
    const code = `<?php

namespace App\\Contracts;

interface PaymentInterface
{
    public function charge(float $amount): void;
    public function refund(string $transactionId): void;
}
`;
    const result = await analyzer.analyze("PaymentInterface.php", code, "test-repo");

    const ifaces = result.symbols.filter((s) => s.kind === SymbolKind.INTERFACE);
    assert.equal(ifaces.length, 1);
    assert.equal(ifaces[0]!.name, "PaymentInterface");
  });

  it("extracts traits", async () => {
    const code = `<?php

namespace App\\Traits;

trait Loggable
{
    public function log(string $message): void
    {
        echo $message;
    }
}
`;
    const result = await analyzer.analyze("Loggable.php", code, "test-repo");

    const traits = result.symbols.filter(
      (s) => s.metadata?.isTrait === true,
    );
    assert.equal(traits.length, 1);
    assert.equal(traits[0]!.name, "Loggable");
  });

  it("extracts enums (PHP 8.1+)", async () => {
    const code = `<?php

enum PaymentStatus: string
{
    case PENDING = 'pending';
    case COMPLETED = 'completed';
    case FAILED = 'failed';
}
`;
    const result = await analyzer.analyze("PaymentStatus.php", code, "test-repo");

    const enums = result.symbols.filter((s) => s.kind === SymbolKind.ENUM);
    assert.equal(enums.length, 1);
  });

  it("extracts methods with visibility modifiers", async () => {
    const code = `<?php

class Calculator
{
    public function add(int $a, int $b): int
    {
        return $a + $b;
    }

    private function validate(int $value): bool
    {
        return $value > 0;
    }

    public static function create(): self
    {
        return new self();
    }
}
`;
    const result = await analyzer.analyze("Calculator.php", code, "test-repo");

    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    assert.equal(methods.length, 3, `Expected 3 methods, got ${methods.length}`);
  });

  it("detects constructor", async () => {
    const code = `<?php

class User
{
    public function __construct(
        private string $name,
        private string $email,
    ) {}
}
`;
    const result = await analyzer.analyze("User.php", code, "test-repo");

    const ctors = result.symbols.filter((s) => s.kind === SymbolKind.CONSTRUCTOR);
    assert.equal(ctors.length, 1);
  });

  it("extracts use statements (imports)", async () => {
    const code = `<?php

namespace App\\Http\\Controllers;

use App\\Services\\UserService;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Log as Logger;

class UserController
{
    // ...
}
`;
    const result = await analyzer.analyze("UserController.php", code, "test-repo");

    const imports = result.relationships.filter((r) => r.kind === RelationshipKind.IMPORTS);
    assert.equal(imports.length, 3, `Expected 3 IMPORTS, got ${imports.length}`);
  });

  it("detects PHP conventions", async () => {
    const code = `<?php

class UserController { }
class UserService { }
class UserRepository { }
class UserDTO { }
class UserEntity { }
`;
    const result = await analyzer.analyze("UserController.php", code, "test-repo");

    const controllers = result.symbols.filter((s) => s.kind === SymbolKind.CONTROLLER);
    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    const repos = result.symbols.filter((s) => s.kind === SymbolKind.REPOSITORY);
    const dtos = result.symbols.filter((s) => s.kind === SymbolKind.DTO);
    const entities = result.symbols.filter((s) => s.kind === SymbolKind.ENTITY);

    assert.equal(controllers.length, 1);
    assert.equal(services.length, 1);
    assert.equal(repos.length, 1);
    assert.equal(dtos.length, 1);
    assert.equal(entities.length, 1);
  });

  it("detects test files", async () => {
    const code = `<?php

class UserServiceTest
{
    public function testCreateUser(): void
    {
        // test
    }
}
`;
    const result = await analyzer.analyze("tests/UserServiceTest.php", code, "test-repo");

    const tests = result.symbols.filter((s) => s.metadata?.isTest === true);
    assert.equal(tests.length, 1);
  });

  it("skips files without PHP opening tag", async () => {
    const code = `This is not PHP code`;
    const result = await analyzer.analyze("README.php", code, "test-repo");

    assert.equal(result.symbols.length, 0);
    assert.equal(result.relationships.length, 0);
  });

  it("returns empty results for empty file", async () => {
    const result = await analyzer.analyze("empty.php", "", "test-repo");
    assert.equal(result.errors.length, 0);
  });

  it("abstract classes are CLASS kind, not interface-like", async () => {
    const code = `<?php

namespace App;

abstract class AbstractStorage
{
    abstract public function find(int $id): mixed;
}
`;
    const result = await analyzer.analyze("AbstractStorage.php", code, "test-repo");

    const classSym = result.symbols.find((s) => s.name === "AbstractStorage");
    assert.ok(classSym, "BaseRepository symbol missing");
    assert.equal(classSym.kind, SymbolKind.CLASS);
    assert.equal(classSym.metadata?.isAbstract, true);
  });

  it("enum and trait methods are extracted with parentClass", async () => {
    const code = `<?php

enum Status: string
{
    case Open = 'open';

    public function label(): string
    {
        return $this->value;
    }
}

trait Loggable
{
    public function log(string $msg): void
    {
        echo $msg;
    }
}
`;
    const result = await analyzer.analyze("Status.php", code, "test-repo");

    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    assert.equal(methods.length, 2, `Expected 2 methods, got ${methods.length}`);

    const enumMethod = methods.find((m) => m.name === "label");
    const traitMethod = methods.find((m) => m.name === "log");
    assert.equal(enumMethod?.parentClass, "Status");
    assert.equal(traitMethod?.parentClass, "Loggable");
  });

  it("global function after a class is still extracted", async () => {
    const code = `<?php

class Helper
{
    public function run(): void {}
}

function bootstrap(): void
{
    Helper::run();
}
`;
    const result = await analyzer.analyze("helpers.php", code, "test-repo");

    const func = result.symbols.find((s) => s.name === "bootstrap");
    assert.ok(func, "bootstrap() missing — currentClass was not reset");
    assert.equal(func.kind, SymbolKind.FUNCTION);
  });

  it("extracts static, method and new calls", async () => {
    const code = `<?php

class OrderProcessor
{
    public function process(): void
    {
        $logger = new Logger();
        $logger->info("processing");
        self::validate();
        $this->finish();
    }
}
`;
    const result = await analyzer.analyze("OrderProcessor.php", code, "test-repo");

    const calls = result.relationships.filter((r) => r.kind === RelationshipKind.CALLS);
    assert.equal(calls.length, 4, `Expected 4 CALLS, got ${calls.length}`);
  });

  it("sourceSnippet contains real code text", async () => {
    const code = `<?php

class SnippetDemo
{
    public function hello(): string
    {
        return 'hi';
    }
}
`;
    const result = await analyzer.analyze("SnippetDemo.php", code, "test-repo");

    const sym = result.symbols.find((s) => s.name === "SnippetDemo");
    assert.ok(sym, "SnippetDemo missing");
    assert.ok(sym.sourceSnippet.includes("class SnippetDemo"), `snippet: ${sym.sourceSnippet}`);
    assert.ok(!/^\d+:\d+$/.test(sym.sourceSnippet.trim()), `snippet looks like a line range: ${sym.sourceSnippet}`);
  });

  it("extracts attributes (PHP 8+)", async () => {
    const code = `<?php

namespace App;

#[Route('/api')]
class ApiController
{
}
`;
    const result = await analyzer.analyze("ApiController.php", code, "test-repo");

    const attrs = result.symbols.filter((s) => s.kind === SymbolKind.ATTRIBUTE);
    assert.equal(attrs.length, 1);
  });
});
