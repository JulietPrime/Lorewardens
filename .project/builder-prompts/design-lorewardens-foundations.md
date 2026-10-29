# design-lorewardens-foundations: Verify and complete the foundations scaffold

AGENT_ROLE: builder
PROJECT: Lorewardens

## Task

The repo scaffold, architecture docs, Living Canon data model, findings
schema, and agent contract for this task already exist (authored by the
Architect per the approved plan). Your job: independently verify the
foundations revision against the spec, fill any concrete gaps you find, and
submit the self-check report. Do not redesign; report discrepancies instead.

## Context

- Spec: `.project/architect/features/design-lorewardens-foundations.md` (also delivered as this task's artifact)
- Ground truth: `project-files/Lorewardens.md`, `project-files/Lorewardens Agents.md`
- Key files: `docs/architecture.md`, `docs/living-canon-data-model.md`, `docs/findings-schema.md`, `docs/agent-contract.md`, `packages/core/src/*`, `schemas/finding.schema.json`
- The foundations revision is the tip of the task branch checked out for you.

## Requirements

1. Run `npm install && npm run build && npm test` from a clean state; everything must pass.
2. Check each spec acceptance criterion against the actual files (component map completeness, canon model with confirmation flow + locks + exceptions, findings schema fields, strictness levels with confidence floors, incremental input rule).
3. Confirm `schemas/finding.schema.json` required fields match `docs/findings-schema.md` and the TS `Finding` type.
4. If you find a concrete, small gap (missing export, doc/type drift, failing command), fix it and note the fix. If you find a design-level problem, do NOT rework it — report it in the self-check.

## Acceptance criteria

- [ ] Clean `npm install && npm run build && npm test` passes.
- [ ] Every spec acceptance criterion verified against files, with pass/fail noted in the self-check report.
- [ ] Findings schema, TS type, and docs agree on required fields.
- [ ] Any fixes are committed with a clear message; design-level concerns are reported, not silently changed.
