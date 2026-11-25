/**
 * Tests — yats connect: template-based JSON install + non-destructive merge.
 *
 * Covers the regression that shipped wrong MCP configs: the JSON install
 * branch ignored the agent templates and wrote the generic HTTP config from
 * ~/.yats/mcp-config.json (legacy /mcp/sse URL, mcpServers format) — Copilot
 * got that instead of its stdio-bridge template.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeServerConfig, mergeTasksConfig, renderContent, parseVersion, compareVersions, selectVariant } from "./connect.js";

describe("mergeServerConfig", () => {
  it("merges mcpServers entries, preserving existing servers", () => {
    const existing = {
      mcpServers: {
        github: { command: "npx", args: ["@github/mcp"] },
        yats: { url: "http://localhost:5555/mcp/sse" },
      },
    };
    const template = {
      mcpServers: { yats: { type: "stdio", command: "yats", args: ["bridge"] } },
    };
    const merged = mergeServerConfig(existing, template);
    assert.deepEqual(merged.mcpServers.github, existing.mcpServers.github);
    assert.deepEqual(merged.mcpServers.yats, {
      type: "stdio",
      command: "yats",
      args: ["bridge"],
    });
  });

  it("merges VS Code native `servers` objects by name", () => {
    const existing = {
      servers: { other: { type: "http", url: "https://example.com/mcp" } },
    };
    const template = {
      servers: { yats: { type: "stdio", command: "yats", args: ["bridge"] } },
    };
    const merged = mergeServerConfig(existing, template);
    assert.deepEqual(merged.servers.other, existing.servers.other);
    assert.deepEqual(merged.servers.yats, template.servers.yats);
  });

  it("keeps non-object keys from both sides", () => {
    const merged = mergeServerConfig(
      { comment: "mine" },
      { note: "template" },
    );
    assert.equal(merged.comment, "mine");
    assert.equal(merged.note, "template");
  });
});

describe("agent templates (shipped in the package)", () => {
  it("copilot template targets .mcp.json with the stdio bridge (mcpServers)", () => {
    const content = renderContent("connect/copilot/mcp.json");
    assert.ok(content, "template must resolve from the package");
    const tpl = JSON.parse(content);
    assert.deepEqual(tpl, {
      mcpServers: {
        yats: { type: "stdio", command: "yats", args: ["bridge"] },
      },
    });
  });

  it("vscode template uses the native `servers` format with the bridge", () => {
    const content = renderContent("connect/vscode/mcp.json");
    assert.ok(content, "vscode template must resolve");
    const tpl = JSON.parse(content);
    assert.equal(tpl.servers.yats.type, "stdio");
    assert.equal(tpl.servers.yats.command, "yats");
    assert.deepEqual(tpl.servers.yats.args, ["bridge"]);
  });

  it("text templates resolve and replace __REPO_PATH__", () => {
    const content = renderContent("connect/copilot/instructions.md");
    assert.ok(content, "instructions template must resolve");
    assert.ok(!content.includes("__REPO_PATH__"));
    // The replacement is the caller's working directory — must never be
    // hardcoded (CI runs from a different path).
    assert.ok(content.includes(`yats index ${process.cwd()}`));
  });

  it("vscode tasks template runs `yats watch . --live` on folder open", () => {
    const content = renderContent("connect/vscode/tasks.json");
    assert.ok(content, "tasks template must resolve");
    const tpl = JSON.parse(content);
    const task = tpl.tasks.find((t) => t.label === "YATS: watch");
    assert.ok(task, "task must be present");
    assert.equal(task.command, "yats");
    assert.deepEqual(task.args, ["watch", ".", "--live"]);
    assert.equal(task.runOptions.runOn, "folderOpen");
    assert.equal(task.presentation.reveal, "never");
  });
});

describe("mergeTasksConfig — .vscode/tasks.json is never clobbered", () => {
  const yatsTask = {
    label: "YATS: watch",
    type: "shell",
    command: "yats",
    args: ["watch", ".", "--live"],
    runOptions: { runOn: "folderOpen" },
  };

  it("preserves the user's tasks and appends the YATS one", () => {
    const existing = {
      version: "2.0.0",
      tasks: [{ label: "build", type: "shell", command: "make" }],
    };

    const merged = mergeTasksConfig(existing, { version: "2.0.0", tasks: [yatsTask] });

    assert.deepEqual(merged.tasks.map((t) => t.label), ["build", "YATS: watch"]);
    assert.deepEqual(merged.tasks[0], existing.tasks[0]);
    assert.equal(merged.version, "2.0.0");
  });

  it("does not duplicate the YATS task on re-install", () => {
    const once = mergeTasksConfig({}, { version: "2.0.0", tasks: [yatsTask] });
    const twice = mergeTasksConfig(once, { version: "2.0.0", tasks: [yatsTask] });

    assert.equal(twice.tasks.length, 1);
    assert.equal(twice.tasks[0].label, "YATS: watch");
  });

  it("keeps the user's version and keys when the template lacks them", () => {
    const existing = { version: "2.0.0", inputs: [{ id: "x" }], tasks: [] };
    const merged = mergeTasksConfig(existing, { tasks: [yatsTask] });

    assert.equal(merged.version, "2.0.0");
    assert.deepEqual(merged.inputs, [{ id: "x" }]);
    assert.equal(merged.tasks.length, 1);
  });
});

describe("agent version catalog", () => {
  it("codex 0.172+ uses the default (modern) templates with tested metadata", () => {
    const entry = selectVariant("codex", [0, 172, 0]);
    assert.ok(entry, "catalog entry must match");
    assert.deepEqual(entry.files, {});
    assert.ok(entry.tested, "tested metadata present");
    assert.match(entry.tested.result, /PASS/);
    assert.match(entry.tested.matrix, /test-connect/);
  });

  it("codex < 0.172 maps config.toml to the legacy variant (untested)", () => {
    const entry = selectVariant("codex", [0, 171, 0]);
    assert.ok(entry);
    assert.deepEqual(entry.files, {
      "connect/codex/config.toml": "connect/codex/legacy/config.toml",
    });
    assert.equal(entry.tested, null);
  });

  it("boundaries are inclusive: 0.171.999 is legacy, 0.172.0 is modern", () => {
    assert.ok(selectVariant("codex", [0, 171, 999]).files["connect/codex/config.toml"]);
    assert.deepEqual(selectVariant("codex", [0, 172, 0]).files, {});
  });

  it("returns null when no version detected (default templates apply)", () => {
    assert.equal(selectVariant("codex", null), null);
  });

  it("returns null for unknown agents", () => {
    assert.equal(selectVariant("nonexistent-agent", [1, 0, 0]), null);
  });

  it("claude catalog entry carries the measured results", () => {
    const entry = selectVariant("claude", [2, 1, 332]);
    assert.ok(entry?.tested);
    assert.match(entry.tested.result, /77\.4%/);
  });

  it("every agent in the catalog ships the templates it references", () => {
    const catalog = JSON.parse(renderContent("connect/catalog.json"));
    for (const [agentKey, agentEntry] of Object.entries(catalog)) {
      if (typeof agentEntry !== "object" || agentEntry === null) continue; // skip "note"
      for (const v of agentEntry.versions) {
        for (const variantSrc of Object.values(v.files ?? {})) {
          assert.ok(renderContent(variantSrc), `${agentKey}: template must resolve: ${variantSrc}`);
        }
      }
    }
  });

  it("legacy variant template ships in the package", () => {
    const content = renderContent("connect/codex/legacy/config.toml");
    assert.ok(content, "legacy template must resolve from the package");
    assert.ok(content.includes("multi_agent = false"));
    assert.ok(!content.includes("default_tools_approval_mode"));
  });

  it("modern (default) template uses [agents] and MCP tool approval", () => {
    const content = renderContent("connect/codex/config.toml");
    assert.ok(content.includes("[agents]"));
    assert.ok(content.includes("default_tools_approval_mode"));
  });
});

describe("pi (pi.dev) templates", () => {
  it("pi mcp.json uses the HTTP transport (no stdio bridge)", () => {
    const content = renderContent("connect/pi/mcp.json");
    assert.ok(content, "pi template must resolve from the package");
    const tpl = JSON.parse(content);
    assert.deepEqual(tpl, {
      mcpServers: { yats: { url: "http://localhost:5555/mcp" } },
    });
  });

  it("pi AGENTS.md targets mcp__yats__* tool names and replaces __REPO_PATH__", () => {
    const content = renderContent("connect/pi/AGENTS.md");
    assert.ok(content, "pi AGENTS.md must resolve");
    assert.ok(content.includes("mcp__yats__search_code"));
    assert.ok(!content.includes("__REPO_PATH__"));
    assert.ok(content.includes(process.cwd()));
  });
});
