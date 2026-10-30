import { chromiumAppRedirectUri } from "../lib/google/auth.js";
import type { PanelResponse } from "../lib/protocol.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

const status = el("status");

async function send(request: unknown): Promise<PanelResponse> {
  return (await chrome.runtime.sendMessage(request)) as PanelResponse;
}

el("extensionId").textContent = chrome.runtime.id;
el("redirectUri").textContent = chromiumAppRedirectUri(chrome.runtime.id);

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken", "oauthClientId"]);
  if (typeof stored["bridgeUrl"] === "string") el<HTMLInputElement>("bridgeUrl").value = stored["bridgeUrl"];
  if (typeof stored["bridgeToken"] === "string") el<HTMLInputElement>("bridgeToken").value = stored["bridgeToken"];
  if (typeof stored["oauthClientId"] === "string") {
    el<HTMLInputElement>("oauthClientId").value = stored["oauthClientId"];
  }
}

el("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    bridgeUrl: el<HTMLInputElement>("bridgeUrl").value.trim(),
    bridgeToken: el<HTMLInputElement>("bridgeToken").value.trim(),
    oauthClientId: el<HTMLInputElement>("oauthClientId").value.trim(),
  });
  status.textContent = "Saved.";
});

el("test").addEventListener("click", async () => {
  status.textContent = "Checking bridge…";
  const response = await send({ type: "bridge-health" });
  if (response.ok && response.kind === "bridge-health") {
    status.textContent = `Bridge ok — ${response.health.agents} agents registered.`;
  } else {
    status.textContent = response.ok ? "Bridge check failed." : `Bridge check failed: ${response.error}`;
  }
});

void load();
