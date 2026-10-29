import { randomUUID } from "node:crypto";
import { surfacesAt } from "./strictness.js";
import type {
  CanonException,
  ContinuityAgentId,
  DismissedFinding,
  Finding,
  ProjectSettings,
  Severity,
  Strictness,
} from "./types.js";

export type FindingDraft = Omit<Finding, "id" | "createdAt">;

export function makeFinding(draft: FindingDraft): Finding {
  return { ...draft, id: `fnd_${randomUUID()}`, createdAt: new Date().toISOString() };
}

export function filterFindings(
  findings: Finding[],
  opts: {
    strictness: Strictness;
    settings: ProjectSettings;
    agentId?: ContinuityAgentId;
  },
): Finding[] {
  const dismissed = new Set(opts.settings.dismissed.map((d: DismissedFinding) => d.findingId));
  const exceptions = opts.settings.exceptions.filter(
    (e: CanonException) => e.agentId === undefined || e.agentId === opts.agentId,
  );
  return findings.filter((f) => {
    if (dismissed.has(f.id)) return false;
    if (!surfacesAt(f, opts.strictness)) return false;
    for (const e of exceptions) {
      if (e.scope === "finding" && e.ref === f.id) return false;
      if (e.scope === "passage" && f.location.file === e.ref) return false;
      if (e.scope === "rule" && f.type === e.ref) return false;
    }
    return true;
  });
}

export function severityRank(severity: Severity): number {
  return { info: 0, minor: 1, major: 2, critical: 3 }[severity];
}
