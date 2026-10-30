import { HttpBridgeClient } from "../lib/bridge-client.js";
import {
  clearLorewardensComments,
  runFullCheck,
  runIncrementalCheck,
  type CheckOutcome,
} from "../lib/pipeline.js";
import type { CheckOutcomeView, PanelRequest, PanelResponse } from "../lib/protocol.js";
import { DocsApi } from "../lib/google/docs.js";
import { DriveCommentsApi } from "../lib/google/drive-comments.js";
import {
  acquireAccessToken,
  chromiumAppRedirectUri,
  isTokenUsable,
  launchWebAuthFlow,
  type AccessToken,
} from "../lib/google/auth.js";
import type { SnapshotStore } from "../lib/types.js";

const WATCH_ALARM = "lorewardens-watch";
const WATCH_PERIOD_MINUTES = 0.5;
const CONFIG_KEYS = ["bridgeUrl", "bridgeToken", "oauthClientId"] as const;

interface BridgeConfig {
  bridgeUrl: string;
  bridgeToken: string;
  oauthClientId: string;
}

interface WatchState {
  documentId: string | null;
  projectId: string;
}

let cachedToken: AccessToken | undefined;

async function loadConfig(): Promise<Partial<BridgeConfig>> {
  const stored = await chrome.storage.local.get([...CONFIG_KEYS]);
  const config: Partial<BridgeConfig> = {};
  if (typeof stored["bridgeUrl"] === "string") config.bridgeUrl = stored["bridgeUrl"];
  if (typeof stored["bridgeToken"] === "string") config.bridgeToken = stored["bridgeToken"];
  if (typeof stored["oauthClientId"] === "string") config.oauthClientId = stored["oauthClientId"];
  return config;
}

function isComplete(config: Partial<BridgeConfig>): config is BridgeConfig {
  return (
    config.bridgeUrl !== undefined &&
    config.bridgeToken !== undefined &&
    config.oauthClientId !== undefined
  );
}

async function tokenProvider(config: BridgeConfig): Promise<string> {
  if (isTokenUsable(cachedToken, Date.now())) {
    return cachedToken!.token;
  }
  const redirectUri = chromiumAppRedirectUri(chrome.runtime.id);
  cachedToken = await acquireAccessToken({ clientId: config.oauthClientId, redirectUri }, launchWebAuthFlow);
  return cachedToken.token;
}

async function buildDeps(config: BridgeConfig) {
  const getToken = () => tokenProvider(config);
  return {
    docs: new DocsApi({ tokenProvider: getToken }),
    comments: new DriveCommentsApi({ tokenProvider: getToken }),
    bridge: new HttpBridgeClient({ baseUrl: config.bridgeUrl, token: config.bridgeToken }),
    snapshots: chromeSessionSnapshots(),
  };
}

function chromeSessionSnapshots(): SnapshotStore {
  return {
    async get(key: string): Promise<string | undefined> {
      const stored = await chrome.storage.session.get([key]);
      const value = stored[key];
      return typeof value === "string" ? value : undefined;
    },
    async set(key: string, value: string): Promise<void> {
      await chrome.storage.session.set({ [key]: value });
    },
  };
}

function documentIdFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match === null ? null : (match[1] as string);
}

async function handle(request: PanelRequest): Promise<PanelResponse> {
  switch (request.type) {
    case "configure": {
      const config = await loadConfig();
      return {
        ok: true,
        kind: "configure",
        config: {
          extensionId: chrome.runtime.id,
          hasBridgeUrl: config.bridgeUrl !== undefined,
          hasBridgeToken: config.bridgeToken !== undefined,
          hasOauthClientId: config.oauthClientId !== undefined,
          ...(config.bridgeUrl !== undefined ? { bridgeUrl: config.bridgeUrl } : {}),
        },
      };
    }
    case "bridge-health": {
      const config = await loadConfig();
      if (!isComplete(config)) return { ok: false, error: "Configure the bridge URL, token and OAuth client id in the options page first." };
      const client = new HttpBridgeClient({ baseUrl: config.bridgeUrl, token: config.bridgeToken });
      return { ok: true, kind: "bridge-health", health: await client.health() };
    }
    case "grab-active-doc": {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const active = tabs[0];
      return {
        ok: true,
        kind: "grab-active-doc",
        doc: { documentId: documentIdFromUrl(active?.url), ...(active?.title !== undefined ? { title: active.title } : {}) },
      };
    }
    case "get-settings": {
      const config = await loadConfig();
      if (!isComplete(config)) return { ok: false, error: "Configure the extension in the options page first." };
      const client = new HttpBridgeClient({ baseUrl: config.bridgeUrl, token: config.bridgeToken });
      const settings = await client.settings(request.projectId);
      return {
        ok: true,
        kind: "settings",
        settings: {
          projectId: settings.projectId,
          agents: settings.agents.map((a) => ({ agentId: a.agentId, enabled: a.enabled, strictness: a.strictness })),
        },
      };
    }
    case "run-full-check": {
      const config = await loadConfig();
      if (!isComplete(config)) return { ok: false, error: "Configure the extension in the options page first." };
      const deps = await buildDeps(config);
      const outcome = await runFullCheck(deps, {
        documentId: request.documentId,
        projectId: request.projectId,
      });
      return { ok: true, kind: "check", outcome: toView(outcome) };
    }
    case "run-incremental-check": {
      const config = await loadConfig();
      if (!isComplete(config)) return { ok: false, error: "Configure the extension in the options page first." };
      const deps = await buildDeps(config);
      const outcome = await runIncrementalCheck(deps, {
        documentId: request.documentId,
        projectId: request.projectId,
      });
      return { ok: true, kind: "check", outcome: toView(outcome) };
    }
    case "clear-comments": {
      const config = await loadConfig();
      if (!isComplete(config)) return { ok: false, error: "Configure the extension in the options page first." };
      const deps = await buildDeps(config);
      const deleted = await clearLorewardensComments(deps.comments, request.documentId);
      return { ok: true, kind: "clear", clear: { deleted } };
    }
    case "watch": {
      const state: WatchState = { documentId: request.documentId, projectId: request.projectId };
      await chrome.storage.session.set({ "lorewardens.watch": state });
      return { ok: true, kind: "watch" };
    }
  }
}

function toView(outcome: CheckOutcome): CheckOutcomeView {
  return {
    ran: outcome.ran,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    posted: outcome.posted,
    skippedExisting: outcome.skippedExisting,
    invokedAgents: outcome.invokedAgents,
    multiTab: outcome.multiTab,
    findings: outcome.findings.map((f) => ({
      agent: f.agent,
      severity: f.severity,
      type: f.type,
      message: f.message,
      quote: f.quote,
      startOffset: f.location.startOffset,
      endOffset: f.location.endOffset,
    })),
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void (async () => {
    try {
      sendResponse(await handle(message as PanelRequest));
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies PanelResponse);
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create(WATCH_ALARM, { periodInMinutes: WATCH_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WATCH_ALARM) return;
  void (async () => {
    const stored = await chrome.storage.session.get(["lorewardens.watch"]);
    const state = stored["lorewardens.watch"] as WatchState | undefined;
    if (state === undefined || state.documentId === null || state.projectId === "") return;
    const config = await loadConfig();
    if (!isComplete(config)) return;
    const deps = await buildDeps(config);
    try {
      await runIncrementalCheck(deps, {
        documentId: state.documentId,
        projectId: state.projectId,
      });
    } catch (err) {
      console.error("[lorewardens] incremental check failed:", err instanceof Error ? err.message : err);
    }
  })();
});
