import type { BridgeAnalyzeRequest, BridgeAnalyzeResponse } from "@lorewardens/bridge";
import type { ProjectSettings } from "@lorewardens/core";
import type { FetchLike } from "./types.js";

export interface BridgeHealth {
  ok: boolean;
  agents: number;
}

export interface BridgeClient {
  health(): Promise<BridgeHealth>;
  analyze(request: BridgeAnalyzeRequest): Promise<BridgeAnalyzeResponse>;
  settings(projectId: string): Promise<ProjectSettings>;
}

export class HttpBridgeClient implements BridgeClient {
  readonly baseUrl: string;
  readonly token: string;
  private readonly fetchLike: FetchLike;

  constructor(config: { baseUrl: string; token: string }, fetchLike?: FetchLike) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.fetchLike = fetchLike ?? defaultFetch;
  }

  private async requestJson<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
    const response = await this.fetchLike(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Bridge ${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text) as T;
  }

  health(): Promise<BridgeHealth> {
    return this.requestJson<BridgeHealth>("/health");
  }

  analyze(request: BridgeAnalyzeRequest): Promise<BridgeAnalyzeResponse> {
    return this.requestJson<BridgeAnalyzeResponse>("/analyze", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  settings(projectId: string): Promise<ProjectSettings> {
    return this.requestJson<ProjectSettings>(`/settings/${encodeURIComponent(projectId)}`);
  }
}

function defaultFetch(input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<import("./types.js").FetchResponseLike> {
  return fetch(input, init) as unknown as Promise<import("./types.js").FetchResponseLike>;
}
