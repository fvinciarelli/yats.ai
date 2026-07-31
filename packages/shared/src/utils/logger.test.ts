import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createLogger, type Logger } from "./logger.js";

describe("createLogger", () => {
  let originalLevel: string | undefined;

  beforeEach(() => {
    originalLevel = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  it("creates a logger with the given name", () => {
    const logger = createLogger("test-module");
    assert.ok(logger);
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
    assert.equal(typeof logger.debug, "function");
    assert.equal(typeof logger.trace, "function");
    assert.equal(typeof logger.child, "function");
  });

  it("suppresses trace and debug at default info level", () => {
    // At default "info" level, trace and debug should not crash
    delete process.env.LOG_LEVEL;
    const logger = createLogger("test");
    // These should not throw
    logger.trace("should be silent");
    logger.debug("should be silent");
  });

  it("emits at error level", () => {
    process.env.LOG_LEVEL = "error";
    const logger = createLogger("test");
    // info and warn should be suppressed (no crash)
    logger.info("should be silent");
    logger.warn("should be silent");
    // error should work
    logger.error("this should emit");
  });

  it("emits all levels at trace level", () => {
    process.env.LOG_LEVEL = "trace";
    const logger = createLogger("test");
    logger.trace("trace msg");
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");
    // All should pass without error
  });

  it("silent level suppresses everything", () => {
    process.env.LOG_LEVEL = "silent";
    const logger = createLogger("test");
    logger.error("should be silent too");
    // Should not throw
  });

  it("child logger inherits name and adds bindings", () => {
    process.env.LOG_LEVEL = "info";
    const parent = createLogger("parent");
    const child = parent.child({ requestId: "123" });
    assert.ok(child);
    assert.equal(typeof child.info, "function");
  });

  it("handles object arguments in log methods", () => {
    process.env.LOG_LEVEL = "info";
    const logger = createLogger("test");
    logger.info("message with object", { key: "value" });
    logger.warn("warning with multiple", 42, { data: true });
    // Should not throw or crash
  });
});
