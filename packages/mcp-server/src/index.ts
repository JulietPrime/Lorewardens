import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRegistry, type CanonStore } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { defaultFixturesDir, loadFixtures } from "./store.js";
import { buildTools, type ToolDef } from "./tools.js";

export const SERVER_NAME = "lorewardens";
export const SERVER_VERSION = "0.1.0";

export interface LorewardensServerBundle {
  server: McpServer;
  store: CanonStore;
  projectIds: string[];
  tools: ToolDef[];
  skippedFixtures: string[];
}

export function createLorewardensServer(fixturesDir?: string): LorewardensServerBundle {
  const { store, projectIds, skipped } = loadFixtures(fixturesDir ?? defaultFixturesDir());
  const registry = createRegistry(CONTINUITY_AGENTS);
  const tools = buildTools(registry, store);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
      try {
        const result = await tool.handler(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[lorewardens] tool '${tool.name}' failed:`, message);
        return { isError: true, content: [{ type: "text", text: `Lorewardens tool error: ${message}` }] };
      }
    });
  }

  return { server, store, projectIds, tools, skippedFixtures: skipped };
}

export async function main(): Promise<void> {
  const { server, projectIds, tools, skippedFixtures } = createLorewardensServer();
  await server.connect(new StdioServerTransport());
  console.error(
    `[lorewardens] MCP server ready on stdio (no network). Tools: ${tools.map((t) => t.name).join(", ")}. ` +
      `Seeded projects: ${projectIds.join(", ") || "(none)"}.` +
      (skippedFixtures.length > 0 ? ` Skipped fixtures: ${skippedFixtures.length}.` : ""),
  );
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[lorewardens] fatal:", err);
    process.exitCode = 1;
  });
}
