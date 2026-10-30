import { pathToFileURL } from "node:url";
import type { CanonStore } from "@lorewardens/core";
import type { AgentRegistry } from "@lorewardens/core";
import { ALL_AGENTS } from "@lorewardens/agents";
import { defaultFixturesDir, loadFixtures } from "@lorewardens/mcp-server";
import { createRegistryFromAllAgents } from "./analyze.js";
import { createBridgeServer, type BridgeServerOptions } from "./server.js";
import { loadOrCreateToken, resolveTokenFile } from "./token.js";

export const DEFAULT_BRIDGE_PORT = 8765;

export interface BridgeConfig {
  port: number;
  tokenFile: string;
  allowedExtensionId?: string;
  fixturesDir?: string;
}

export function bridgeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const rawPort = env.LOREWARDENS_BRIDGE_PORT;
  let port = DEFAULT_BRIDGE_PORT;
  if (rawPort !== undefined && rawPort !== "") {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`LOREWARDENS_BRIDGE_PORT must be an integer in [0, 65535], got '${rawPort}'.`);
    }
    port = parsed;
  }
  return {
    port,
    tokenFile: resolveTokenFile(env),
    ...(env.LOREWARDENS_EXTENSION_ID !== undefined && env.LOREWARDENS_EXTENSION_ID !== ""
      ? { allowedExtensionId: env.LOREWARDENS_EXTENSION_ID }
      : {}),
    ...(env.LOREWARDENS_BRIDGE_FIXTURES_DIR !== undefined && env.LOREWARDENS_BRIDGE_FIXTURES_DIR !== ""
      ? { fixturesDir: env.LOREWARDENS_BRIDGE_FIXTURES_DIR }
      : {}),
  };
}

export interface BridgeHandle {
  server: ReturnType<typeof createBridgeServer>;
  port: number;
  token: string;
  agents: number;
  projectIds: string[];
}

export interface BridgeStartDeps {
  registry?: AgentRegistry;
  store?: CanonStore;
}

export async function startBridge(config: BridgeConfig, deps?: BridgeStartDeps): Promise<BridgeHandle> {
  const registry = deps?.registry ?? createRegistryFromAllAgents();
  const { store, projectIds } = deps?.store
    ? { store: deps.store, projectIds: [] as string[] }
    : loadFixtures(config.fixturesDir ?? defaultFixturesDir());
  const { token } = loadOrCreateToken(config.tokenFile);
  const options: BridgeServerOptions = {
    registry,
    store,
    token,
    ...(config.allowedExtensionId !== undefined ? { allowedExtensionId: config.allowedExtensionId } : {}),
  };
  const server = createBridgeServer(options);
  return await new Promise<BridgeHandle>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      const port =
        address !== null && typeof address === "object" && "port" in address ? address.port : config.port;
      resolve({ server, port, token, agents: registry.list().length, projectIds });
    });
  });
}

export async function main(): Promise<void> {
  const config = bridgeConfigFromEnv();
  const handle = await startBridge(config);
  console.error(`[lorewardens-bridge] listening on http://127.0.0.1:${handle.port} (loopback only, no egress)`);
  console.error(
    `[lorewardens-bridge] agents: ${handle.agents}; seeded projects: ${handle.projectIds.join(", ") || "(none)"}`,
  );
  console.error(
    `[lorewardens-bridge] token file: ${config.tokenFile} (send as 'Authorization: Bearer <token>')`,
  );
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[lorewardens-bridge] fatal:", err);
    process.exitCode = 1;
  });
}
