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

import { mergeServerConfig, renderContent } from "./connect.js";

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
    assert.match(content, /yats index \/home\/franco\/cosas\/code_indexer/);
  });
});
