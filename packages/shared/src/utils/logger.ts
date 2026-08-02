// ============================================================
// Lightweight structured logger
// ============================================================

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

class ConsoleLogger implements Logger {
  private readonly minLevel: number;

  constructor(
    private readonly name: string,
    level: LogLevel,
    private readonly bindings: Record<string, unknown> = {},
  ) {
    this.minLevel = LOG_LEVELS[level];
  }

  private log(level: LogLevel, msg: string, args: unknown[]): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const entry = {
      level,
      name: this.name,
      time: new Date().toISOString(),
      msg,
      ...this.bindings,
    };

    const output = args.length > 0
      ? `${JSON.stringify(entry)} ${args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`
      : JSON.stringify(entry);

    switch (level) {
      case "error": process.stderr.write(output + "\n"); break;
      case "warn": process.stderr.write(output + "\n"); break;
      default: process.stderr.write(output + "\n");
    }
  }

  trace(msg: string, ...args: unknown[]): void { this.log("trace", msg, args); }
  debug(msg: string, ...args: unknown[]): void { this.log("debug", msg, args); }
  info(msg: string, ...args: unknown[]): void { this.log("info", msg, args); }
  warn(msg: string, ...args: unknown[]): void { this.log("warn", msg, args); }
  error(msg: string, ...args: unknown[]): void { this.log("error", msg, args); }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.name, this.currentLevel(), { ...this.bindings, ...bindings });
  }

  private currentLevel(): LogLevel {
    for (const [key, val] of Object.entries(LOG_LEVELS)) {
      if (val === this.minLevel) return key as LogLevel;
    }
    return "info";
  }
}

/**
 * Create a named logger.
 * Respects LOG_LEVEL environment variable.
 */
export function createLogger(name: string): Logger {
  const level = (process.env.LOG_LEVEL ?? "info") as LogLevel;
  return new ConsoleLogger(name, level);
}
