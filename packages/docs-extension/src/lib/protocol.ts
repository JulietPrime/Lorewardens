import type { Strictness } from "@lorewardens/core";

// Messages the side panel sends to the service worker; the worker owns all
// bridge, Docs, Drive and OAuth access so credentials stay in one place.
export type PanelRequest =
  | { type: "configure" }
  | { type: "bridge-health" }
  | { type: "grab-active-doc" }
  | { type: "get-settings"; projectId: string }
  | { type: "run-full-check"; projectId: string; documentId: string }
  | { type: "run-incremental-check"; projectId: string; documentId: string }
  | { type: "clear-comments"; documentId: string }
  | { type: "watch"; documentId: string | null; projectId: string };

export interface ExtensionConfigView {
  extensionId: string;
  hasBridgeUrl: boolean;
  hasBridgeToken: boolean;
  hasOauthClientId: boolean;
  bridgeUrl?: string;
}

export interface BridgeHealthView {
  ok: boolean;
  agents: number;
}

export interface ActiveDocView {
  documentId: string | null;
  title?: string;
}

export interface CheckOutcomeView {
  ran: boolean;
  reason?: string;
  posted: number;
  skippedExisting: number;
  invokedAgents: string[];
  findings: {
    agent: string;
    severity: string;
    type: string;
    message: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  }[];
  multiTab: boolean;
}

export interface SettingsView {
  projectId: string;
  agents: { agentId: string; enabled: boolean; strictness: string }[];
}

export interface ClearView {
  deleted: number;
}

export type PanelResponse =
  | { ok: true; kind: "configure"; config: ExtensionConfigView }
  | { ok: true; kind: "bridge-health"; health: BridgeHealthView }
  | { ok: true; kind: "grab-active-doc"; doc: ActiveDocView }
  | { ok: true; kind: "settings"; settings: SettingsView }
  | { ok: true; kind: "check"; outcome: CheckOutcomeView }
  | { ok: true; kind: "clear"; clear: ClearView }
  | { ok: true; kind: "watch" }
  | { ok: false; error: string };

export type StrictnessView = Strictness;
