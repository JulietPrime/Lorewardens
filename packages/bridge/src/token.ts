import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOKEN_FILE_NAME = ".lorewardens-bridge.token";

export function resolveTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LOREWARDENS_BRIDGE_TOKEN_FILE;
  if (override !== undefined && override.trim().length > 0) {
    return override;
  }
  return join(process.cwd(), TOKEN_FILE_NAME);
}

export function loadOrCreateToken(tokenFile: string): { token: string; created: boolean } {
  if (existsSync(tokenFile)) {
    const existing = readFileSync(tokenFile, "utf8").trim();
    if (existing.length > 0) {
      return { token: existing, created: false };
    }
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return { token, created: true };
}
