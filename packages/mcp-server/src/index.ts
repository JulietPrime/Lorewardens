import { AGENT_DESCRIPTORS } from "@lorewardens/agents";

const task = "expose-lore-agents-as-local-mcp-tools";

console.error(
  `Lorewardens MCP server is not implemented yet (task ${task}).\n` +
    `Registered agent descriptors:\n` +
    AGENT_DESCRIPTORS.map((d) => `  - ${d.id}: ${d.title}`).join("\n") +
    `\nThis binary will become a stdio MCP server exposing each agent as a tool.`,
);
process.exitCode = 1;
