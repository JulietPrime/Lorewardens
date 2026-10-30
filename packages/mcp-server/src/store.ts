import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CanonException,
  CanonProposal,
  CanonSnapshot,
  CanonStore,
  DismissedFinding,
  ProjectId,
  ProjectSettings,
} from "@lorewardens/core";
import { AGENT_DESCRIPTORS } from "@lorewardens/agents";

export interface FixtureBundle {
  snapshot: CanonSnapshot;
  settings: ProjectSettings;
}

export class ReadOnlyStoreError extends Error {
  constructor(operation: string) {
    super(
      `FixtureCanonStore is read-only: ${operation} requires writer confirmation and is not available through the MCP server.`,
    );
    this.name = "ReadOnlyStoreError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function defaultSettings(projectId: ProjectId): ProjectSettings {
  return {
    projectId,
    agents: AGENT_DESCRIPTORS.map((d) => ({
      agentId: d.id,
      enabled: d.defaultEnabled ?? true,
      strictness: d.defaultStrictness,
      options: Object.fromEntries((d.options ?? []).map((o) => [o.key, o.default])),
    })),
    exceptions: [],
    dismissed: [],
  };
}

export class FixtureCanonStore implements CanonStore {
  private readonly bundles = new Map<ProjectId, FixtureBundle>();

  constructor(bundles: FixtureBundle[]) {
    for (const bundle of bundles) {
      this.bundles.set(bundle.snapshot.projectId, bundle);
    }
  }

  listProjectIds(): ProjectId[] {
    return [...this.bundles.keys()].sort();
  }

  async read(projectId: ProjectId): Promise<CanonSnapshot> {
    const bundle = this.bundles.get(projectId);
    if (!bundle) {
      throw new Error(
        `Unknown project '${projectId}'. Seeded projects: ${this.listProjectIds().join(", ") || "(none)"}.`,
      );
    }
    return clone(bundle.snapshot);
  }

  async settings(projectId: ProjectId): Promise<ProjectSettings> {
    const bundle = this.bundles.get(projectId);
    if (!bundle) {
      throw new Error(
        `Unknown project '${projectId}'. Seeded projects: ${this.listProjectIds().join(", ") || "(none)"}.`,
      );
    }
    return clone(bundle.settings);
  }

  async applyConfirmed(_proposal: CanonProposal): Promise<void> {
    throw new ReadOnlyStoreError("applyConfirmed");
  }

  async addException(_exception: CanonException): Promise<void> {
    throw new ReadOnlyStoreError("addException");
  }

  async dismissFinding(_dismissal: DismissedFinding): Promise<void> {
    throw new ReadOnlyStoreError("dismissFinding");
  }
}

export function defaultFixturesDir(): string {
  return fileURLToPath(new URL("../../fixtures", import.meta.url));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function asSnapshot(raw: unknown, expectedProjectId: string): CanonSnapshot {
  const snapshot = raw as CanonSnapshot;
  if (!snapshot || snapshot.projectId !== expectedProjectId) {
    throw new Error(
      `Canon fixture for project '${expectedProjectId}' must have projectId '${expectedProjectId}'` +
        (snapshot ? `, found '${snapshot.projectId}'` : ""),
    );
  }
  if (!Array.isArray(snapshot.entries) || !Array.isArray(snapshot.characters) || !Array.isArray(snapshot.events)) {
    throw new Error(
      `Canon fixture for project '${expectedProjectId}' must contain entries, characters and events arrays.`,
    );
  }
  return snapshot;
}

export function loadFixtureBundle(fixturesDir: string, projectId: string): FixtureBundle {
  const snapshot = asSnapshot(readJson(join(fixturesDir, `${projectId}.canon.json`)), projectId);
  const settingsPath = join(fixturesDir, `${projectId}.settings.json`);
  let settings: ProjectSettings;
  if (existsSync(settingsPath)) {
    const raw = readJson(settingsPath) as Partial<ProjectSettings>;
    const defaults = defaultSettings(projectId);
    const overrides = raw.agents ?? [];
    const merged = defaults.agents.map((d) => {
      const override = overrides.find((a) => a.agentId === d.agentId);
      return override ? { ...d, ...override, agentId: d.agentId } : d;
    });
    settings = {
      projectId,
      agents: merged,
      exceptions: raw.exceptions ?? [],
      dismissed: raw.dismissed ?? [],
    };
  } else {
    settings = defaultSettings(projectId);
  }
  return { snapshot, settings };
}

export function loadFixtures(fixturesDir: string = defaultFixturesDir()): {
  store: FixtureCanonStore;
  projectIds: ProjectId[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const bundles: FixtureBundle[] = [];
  const projectIds: string[] = [];
  if (!existsSync(fixturesDir)) {
    return { store: new FixtureCanonStore([]), projectIds, skipped };
  }
  for (const file of readdirSync(fixturesDir).sort()) {
    if (!file.endsWith(".canon.json")) continue;
    const projectId = file.slice(0, -".canon.json".length);
    try {
      bundles.push(loadFixtureBundle(fixturesDir, projectId));
      projectIds.push(projectId);
    } catch (err) {
      skipped.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[lorewardens] skipping fixture ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return { store: new FixtureCanonStore(bundles), projectIds: projectIds.sort(), skipped };
}
