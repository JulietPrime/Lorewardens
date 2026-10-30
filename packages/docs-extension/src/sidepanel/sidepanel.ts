import type {
  ActiveDocView,
  CheckOutcomeView,
  ExtensionConfigView,
  PanelResponse,
  SettingsView,
} from "../lib/protocol.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

const status = el("status");
const findingsBox = el("findings");
const settingsBox = el("settings");
const projectInput = el<HTMLInputElement>("projectId");

function setStatus(text: string): void {
  status.textContent = text;
}

async function send(request: unknown): Promise<PanelResponse> {
  return (await chrome.runtime.sendMessage(request)) as PanelResponse;
}

function renderOutcome(outcome: CheckOutcomeView): void {
  findingsBox.textContent = "";
  for (const finding of outcome.findings) {
    const box = document.createElement("div");
    box.className = `finding severity-${finding.severity}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${finding.severity} · ${finding.agent} · ${finding.type}`;
    const message = document.createElement("div");
    message.textContent = finding.message;
    const quote = document.createElement("div");
    quote.className = "quote";
    quote.textContent = `“${finding.quote}”`;
    box.append(meta, message, quote);
    findingsBox.append(box);
  }
  el("multitab").hidden = !outcome.multiTab;
  const parts = [
    outcome.ran
      ? `${outcome.posted} new comment(s), ${outcome.skippedExisting} already present; agents: ${outcome.invokedAgents.join(", ") || "none"}`
      : `Not run: ${outcome.reason ?? "unknown reason"}`,
  ];
  setStatus(parts.join("\n"));
}

async function refreshSettings(projectId: string): Promise<void> {
  const response = await send({ type: "get-settings", projectId });
  if (!response.ok || response.kind !== "settings") {
    settingsBox.textContent = response.ok ? "No settings." : response.error;
    return;
  }
  const settings = response.settings as SettingsView;
  settingsBox.textContent = "";
  for (const agent of settings.agents) {
    const row = document.createElement("div");
    row.className = "agent";
    const name = document.createElement("span");
    name.textContent = agent.agentId;
    const state = document.createElement("span");
    state.textContent = agent.enabled ? agent.strictness : "disabled";
    if (!agent.enabled) state.className = "muted";
    row.append(name, state);
    settingsBox.append(row);
  }
}

async function grabActiveDoc(): Promise<string | null> {
  const response = await send({ type: "grab-active-doc" });
  if (!response.ok || response.kind !== "grab-active-doc") {
    setStatus(response.ok ? "Could not read the active tab." : response.error);
    return null;
  }
  const doc = response.doc as ActiveDocView;
  if (doc.documentId === null) {
    setStatus("Active tab is not a Google Docs document (open the doc, then use the Lorewardens action).");
    return null;
  }
  return doc.documentId;
}

el("grab").addEventListener("click", async () => {
  const documentId = await grabActiveDoc();
  if (documentId !== null) {
    setStatus(`Watching document ${documentId}`);
    await send({ type: "watch", documentId, projectId: projectInput.value.trim() });
  }
});

el("runFull").addEventListener("click", async () => {
  const documentId = await grabActiveDoc();
  if (documentId === null) return;
  const projectId = projectInput.value.trim();
  setStatus("Running full check…");
  await send({ type: "watch", documentId, projectId });
  const response = await send({ type: "run-full-check", projectId, documentId });
  if (!response.ok || response.kind !== "check") {
    setStatus(response.ok ? "Full check failed." : `Full check failed: ${response.error}`);
    return;
  }
  renderOutcome(response.outcome);
  await refreshSettings(projectId);
});

el("clear").addEventListener("click", async () => {
  const documentId = await grabActiveDoc();
  if (documentId === null) return;
  const response = await send({ type: "clear-comments", documentId });
  if (!response.ok || response.kind !== "clear") {
    setStatus(response.ok ? "Clear failed." : `Clear failed: ${response.error}`);
    return;
  }
  setStatus(`Removed ${response.clear.deleted} Lorewardens comment(s). Nothing else was touched.`);
});

projectInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ projectId: projectInput.value.trim() });
  const value = projectInput.value.trim();
  if (value !== "") await refreshSettings(value);
});

void (async () => {
  const config = await send({ type: "configure" });
  if (config.ok && config.kind === "configure") {
    const view = config.config as ExtensionConfigView;
    const missing = [
      view.hasBridgeUrl ? null : "bridge URL",
      view.hasBridgeToken ? null : "bridge token",
      view.hasOauthClientId ? null : "OAuth client id",
    ].filter((item) => item !== null);
    if (missing.length > 0) {
      setStatus(`Missing configuration: ${missing.join(", ")}. Open Options.`);
    } else {
      const health = await send({ type: "bridge-health" });
      if (health.ok && health.kind === "bridge-health") {
        setStatus(`Bridge ok — ${health.health.agents} agents registered.`);
      } else {
        setStatus(health.ok ? "Bridge check failed." : health.error);
      }
    }
  }
  const stored = await chrome.storage.local.get(["projectId"]);
  if (typeof stored["projectId"] === "string" && stored["projectId"] !== "") {
    projectInput.value = stored["projectId"];
    await refreshSettings(projectInput.value.trim());
  }
})();
