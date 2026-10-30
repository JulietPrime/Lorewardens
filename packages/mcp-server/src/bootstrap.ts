import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  bootstrapCanon,
  DEFAULT_GENERATED_AT,
  type CanonSnapshot,
} from "@lorewardens/core";
import type { ToolDef } from "./tools.js";

export const CANON_BOOTSTRAP_TOOL_NAME = "canon_bootstrap";

export const CanonBootstrapInput = z.object({
  projectId: z
    .string()
    .min(1)
    .describe(
      "Project id stamped on every draft item. The draft is a standalone proposal file; " +
        "the canon store is never read or written.",
    ),
  source: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        text: z.string().min(1).describe("The pasted story chunk."),
        label: z
          .string()
          .min(1)
          .optional()
          .describe("Provenance label used in source spans. Defaults to 'pasted-text'."),
      }),
      z.object({
        kind: z.literal("file"),
        path: z
          .string()
          .min(1)
          .describe("Local UTF-8 text file to read. The path as given becomes the provenance label."),
      }),
    ])
    .describe("Exactly one source: pasted text or a local file."),
  generatedAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO 8601 timestamp stamped on every draft item's createdAt/updatedAt. " +
        "Defaults to a fixed constant so output stays byte-deterministic; the " +
        "downstream confirmation flow re-stamps on apply.",
    ),
  outputPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Write the draft snapshot JSON to this local path (2-space indented, trailing " +
        "newline). Refused if the file already exists; the parent directory must " +
        "already exist. Without it the draft is returned in the response only.",
    ),
});

export interface CanonBootstrapToolArgs {
  projectId: string;
  source: { kind: "text"; text: string; label?: string } | { kind: "file"; path: string };
  generatedAt?: string;
  outputPath?: string;
}

export interface CanonBootstrapToolResult {
  projectId: string;
  source: { kind: string; label: string; length: number };
  generatedAt: string;
  snapshot: CanonSnapshot;
  counts: {
    entries: { fact: number; rule: number; history: number; setting: number };
    characters: number;
    events: number;
  };
  notes: string[];
  writtenTo?: string;
}

function resolveSourceText(source: CanonBootstrapToolArgs["source"]): { text: string; label: string } {
  if (source.kind === "text") {
    return { text: source.text, label: source.label ?? "pasted-text" };
  }
  let text: string;
  try {
    text = readFileSync(source.path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read source file '${source.path}': ${reason}`);
  }
  return { text, label: source.path };
}

function writeDraftSnapshot(outputPath: string, snapshot: CanonSnapshot): void {
  if (existsSync(outputPath)) {
    throw new Error(
      `Refusing to write the draft: '${outputPath}' already exists. Bootstrap drafts never ` +
        "overwrite anything; choose a fresh path or remove the file yourself.",
    );
  }
  const parent = dirname(outputPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(
      `Parent directory '${parent}' does not exist or is not a directory. Bootstrap drafts ` +
        "never create directories.",
    );
  }
  const content = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(outputPath, content, { encoding: "utf8", flag: "wx" });
}

export async function runCanonBootstrapTool(rawInput: unknown): Promise<CanonBootstrapToolResult> {
  const input = CanonBootstrapInput.parse(rawInput) as CanonBootstrapToolArgs;
  const { text, label } = resolveSourceText(input.source);
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;

  const { snapshot, notes } = bootstrapCanon({
    projectId: input.projectId,
    source: { text, label },
    generatedAt,
  });

  let writtenTo: string | undefined;
  if (input.outputPath !== undefined) {
    writeDraftSnapshot(input.outputPath, snapshot);
    writtenTo = input.outputPath;
  }

  const counts = {
    entries: {
      fact: snapshot.entries.filter((e) => e.kind === "fact").length,
      rule: snapshot.entries.filter((e) => e.kind === "rule").length,
      history: snapshot.entries.filter((e) => e.kind === "history").length,
      setting: snapshot.entries.filter((e) => e.kind === "setting").length,
    },
    characters: snapshot.characters.length,
    events: snapshot.events.length,
  };

  return {
    projectId: input.projectId,
    source: { kind: input.source.kind, label, length: text.length },
    generatedAt,
    snapshot,
    counts,
    notes,
    ...(writtenTo !== undefined ? { writtenTo } : {}),
  };
}

export function buildCanonBootstrapTool(): ToolDef {
  return {
    name: CANON_BOOTSTRAP_TOOL_NAME,
    description:
      "Turn a pasted story chunk (or a local text file) into a DRAFT canon proposal snapshot in " +
      "the exact fixture shape: every item is status 'proposed', nothing auto-confirms, the " +
      "canon store is untouched, zero network. Pass outputPath to write the draft to a fresh " +
      "local file (existing files are never overwritten).",
    inputSchema: CanonBootstrapInput,
    handler: (args) => runCanonBootstrapTool(args),
  };
}
