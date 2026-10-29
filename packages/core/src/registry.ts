import type { ContinuityAgent } from "./agent.js";
import type { AgentDescriptor } from "./types.js";

export class AgentRegistry {
  private agents = new Map<string, ContinuityAgent>();

  register(agent: ContinuityAgent): void {
    this.agents.set(agent.id, agent);
  }

  get(id: string): ContinuityAgent | undefined {
    return this.agents.get(id);
  }

  list(): AgentDescriptor[] {
    return [...this.agents.values()].map((a) => a.descriptor);
  }
}

export function createRegistry(agents: ContinuityAgent[]): AgentRegistry {
  const registry = new AgentRegistry();
  for (const agent of agents) registry.register(agent);
  return registry;
}
