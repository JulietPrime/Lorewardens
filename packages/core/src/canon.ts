import type {
  CanonEntry,
  CanonException,
  CanonProposal,
  CanonSnapshot,
  Character,
  DismissedFinding,
  ProjectId,
  ProjectSettings,
  TimelineEvent,
} from "./types.js";

export interface CanonStore {
  read(projectId: ProjectId): Promise<CanonSnapshot>;
  settings(projectId: ProjectId): Promise<ProjectSettings>;
  applyConfirmed(proposal: CanonProposal): Promise<void>;
  addException(exception: CanonException): Promise<void>;
  dismissFinding(dismissal: DismissedFinding): Promise<void>;
}

export class InMemoryCanonStore implements CanonStore {
  private snapshots = new Map<ProjectId, CanonSnapshot>();
  private settingsByProject = new Map<ProjectId, ProjectSettings>();

  constructor(initial?: CanonSnapshot[]) {
    for (const snapshot of initial ?? []) {
      this.snapshots.set(snapshot.projectId, snapshot);
      this.settingsByProject.set(snapshot.projectId, {
        projectId: snapshot.projectId,
        agents: [],
        exceptions: [],
        dismissed: [],
      });
    }
  }

  async read(projectId: ProjectId): Promise<CanonSnapshot> {
    return (
      this.snapshots.get(projectId) ?? {
        projectId,
        entries: [],
        characters: [],
        events: [],
      }
    );
  }

  async settings(projectId: ProjectId): Promise<ProjectSettings> {
    return (
      this.settingsByProject.get(projectId) ?? {
        projectId,
        agents: [],
        exceptions: [],
        dismissed: [],
      }
    );
  }

  async applyConfirmed(proposal: CanonProposal): Promise<void> {
    const snapshot = await this.read(proposal.projectId);
    if (proposal.subjectKind === "canon-entry") {
      const entry = proposal.payload as CanonEntry;
      if (proposal.action === "add") snapshot.entries.push(entry);
      if (proposal.action === "update") {
        snapshot.entries = snapshot.entries.map((e) => (e.id === entry.id ? entry : e));
      }
      if (proposal.action === "retire") {
        snapshot.entries = snapshot.entries.map((e) =>
          e.id === entry.id ? { ...e, status: "retired", updatedAt: new Date().toISOString() } : e,
        );
      }
    }
    if (proposal.subjectKind === "character") {
      const character = proposal.payload as Character;
      if (proposal.action === "add") snapshot.characters.push(character);
      if (proposal.action === "update") {
        snapshot.characters = snapshot.characters.map((c) => (c.id === character.id ? character : c));
      }
      if (proposal.action === "retire") {
        snapshot.characters = snapshot.characters.map((c) =>
          c.id === character.id ? { ...c, status: "retired", updatedAt: new Date().toISOString() } : c,
        );
      }
    }
    if (proposal.subjectKind === "timeline-event") {
      const event = proposal.payload as TimelineEvent;
      if (proposal.action === "add") snapshot.events.push(event);
      if (proposal.action === "update") {
        snapshot.events = snapshot.events.map((e) => (e.id === event.id ? event : e));
      }
      if (proposal.action === "retire") {
        snapshot.events = snapshot.events.map((e) =>
          e.id === event.id ? { ...e, status: "retired", updatedAt: new Date().toISOString() } : e,
        );
      }
    }
    this.snapshots.set(proposal.projectId, snapshot);
  }

  async addException(exception: CanonException): Promise<void> {
    const settings = await this.settings(exception.projectId);
    settings.exceptions.push(exception);
    this.settingsByProject.set(exception.projectId, settings);
  }

  async dismissFinding(dismissal: DismissedFinding): Promise<void> {
    const settings = await this.settings(dismissal.projectId);
    settings.dismissed.push(dismissal);
    this.settingsByProject.set(dismissal.projectId, settings);
  }
}
