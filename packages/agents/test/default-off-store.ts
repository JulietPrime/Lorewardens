// The agents workspace builds before @lorewardens/mcp-server in the root
// build order, so this test may not statically import its dist. The root
// `npm test` builds every workspace before any test runs, so the module
// exists at test runtime; a computed specifier keeps the agents build clean
// while still exercising the real shipped store module.

export interface StoreSettingsRow {
  agentId: string;
  enabled: boolean;
  strictness: string;
  options: Record<string, boolean | string | number>;
}

export interface StoreSettings {
  projectId: string;
  agents: StoreSettingsRow[];
  exceptions: unknown[];
  dismissed: unknown[];
}

export interface DefaultOffStoreHelpers {
  defaultSettings(projectId: string): StoreSettings;
  loadFixtureBundle(fixturesDir: string, projectId: string): { snapshot: unknown; settings: StoreSettings };
}

let cached: DefaultOffStoreHelpers | undefined;

export async function defaultOffStoreHelpers(): Promise<DefaultOffStoreHelpers> {
  if (!cached) {
    const specifier = ["@lorewardens", "mcp-server", "dist", "src", "store.js"].join("/");
    cached = (await import(specifier)) as DefaultOffStoreHelpers;
  }
  return cached;
}
