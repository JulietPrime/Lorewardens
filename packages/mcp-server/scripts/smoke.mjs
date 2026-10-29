#!/usr/bin/env node
// Smoke test: drives the built Lorewardens MCP server over real stdio using
// the MCP SDK client. Verifies tool discovery, one analyze call and the
// read-only canon_list call. Exits non-zero on any failure.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});

const client = new Client({ name: "lorewardens-smoke", version: "0.1.0" });
await client.connect(transport);

try {
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  console.log("registered tools:", names.join(", "));
  const expected = [
    "analyze_canon_lore",
    "analyze_character_consistency",
    "analyze_timeline",
    "canon_list",
  ];
  for (const name of expected) {
    if (!names.includes(name)) fail(`missing tool ${name}`);
  }

  const analyze = await client.callTool({
    name: "analyze_canon_lore",
    arguments: {
      projectId: "demo",
      chunk: {
        text: "Mira sketched the Weeping Gate while Daven dropped the measuring line again.",
        file: "demo/ch1.md",
        startOffset: 0,
        endOffset: 78,
      },
      strictness: "standard",
    },
  });
  if (analyze.isError) fail(`analyze_canon_lore returned an error: ${JSON.stringify(analyze)}`);
  const analyzeResult = JSON.parse(analyze.content[0].text);
  console.log("analyze_canon_lore:", JSON.stringify(analyzeResult, null, 2));
  if (analyzeResult.invoked !== true) fail("analyze_canon_lore did not invoke the agent");
  if (!Array.isArray(analyzeResult.findings)) fail("findings is not an array");

  const off = await client.callTool({
    name: "analyze_timeline",
    arguments: {
      projectId: "demo",
      chunk: { text: "Mira walked the wall.", file: "demo/ch1.md", startOffset: 0, endOffset: 21 },
      strictness: "off",
    },
  });
  const offResult = JSON.parse(off.content[0].text);
  console.log("analyze_timeline (off):", JSON.stringify(offResult));
  if (offResult.invoked !== false || offResult.findings.length !== 0 || !offResult.reason) {
    fail("strictness off must return an empty result with a reason");
  }

  const canon = await client.callTool({ name: "canon_list", arguments: { projectId: "demo" } });
  if (canon.isError) fail(`canon_list returned an error: ${JSON.stringify(canon)}`);
  const canonResult = JSON.parse(canon.content[0].text);
  console.log(
    "canon_list counts:",
    JSON.stringify(canonResult.counts),
    "| entries:",
    canonResult.snapshot.entries.length,
    "characters:",
    canonResult.snapshot.characters.length,
    "events:",
    canonResult.snapshot.events.length,
  );
  if (canonResult.snapshot.projectId !== "demo") fail("canon_list returned the wrong project");
  if (canonResult.snapshot.entries.length < 1) fail("canon_list returned no entries");

  console.log("SMOKE OK");
} finally {
  await client.close();
}
