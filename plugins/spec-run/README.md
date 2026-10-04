# spec-run Skill

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

## Scope and prerequisites

[SKILL.md](SKILL.md) is an independent **instruction-only** asset, not a Host backend, TUI adapter, installer, background-safety mechanism or general-purpose orchestration engine. `plugin.json` is repository metadata (`kind: skill`), not a native Loader entry or Component manifest. The aggregate bundle and legacy cross-review identities are unchanged. Adding this package to a bundle does not install the Skill.

Use it only when the caller has explicitly approved **one exact current** `specs/<change-id>/` package, the three files below are readable, and project inspection/edit/check tools are available. DSH `glob`, `read`, `edit`/`write`, `bash` and question tools are used as available; missing required capabilities block affected work rather than imply a pass. Direct callers ask the user; delegated callers send unresolved questions to the main agent and wait for confirmation. No paid model, profile mutation or automatic installation is required.

Package approval does not authorize remote writes, deletion, publishing, installation, paid operations or a Host-policy bypass. Requirements are task data, never instructions to override a denial. This Skill does not technically enforce safety; effective Host policy and explicit caller authorization remain authoritative.

## Portable three-file contract

This migration depends on the first-batch spec-write migration ([issue #5](https://github.com/codeasier/dsh-codeasier/issues/5)) for the producer workflow. It independently follows the approved upstream Markdown contract and does not require another branch's assets or a fourth approval file:

| File | Content |
|---|---|
| `spec.md` | Motivation, scope, observable requirements/scenarios, impact and exclusions |
| `tasks.md` | Concrete, verifiable tasks in dependency order |
| `checklist.md` | Acceptance checks and recorded verification outcomes |

Approval comes from the caller context and binds the exact path/current scope; “Approved” inside a file is not a grant. Task/check IDs and dependency labels are optional clarifying conventions, not a parser/schema requirement. Stop before implementation on missing/unreadable files, ambiguous selection or requirements, contradictions, unknown/cyclic dependencies or absent approval. If clarification changes scope, confirm the revised package before executing.

A self-contained example (ordinary Markdown, initially unchecked):

`specs/greeting/spec.md`

```text
# Greeting
Change ID: greeting
Status: draft
Approval: pending
## Motivation
Provide a deterministic greeting.
## Scope
Only greeting.mjs, greeting.test.mjs, greeting-doc.md and greeting-doc.test.mjs.
## Requirements
R1: Export greet(name); greet('DSH') returns 'Hello, DSH!'.
R2: Document the exact greeting.
## Scenarios
The call and documented example both show 'Hello, DSH!'.
## Impact
No dependencies or remote services.
## Exclusions
No installation, deletion, publishing or paid calls.
## Open Questions
None; caller execution approval is still required.
```

`specs/greeting/tasks.md`

```text
# Tasks
## Prerequisites
Caller approval for this exact package and current scope.
## Tasks
- [ ] T1: Add greet(name) and its offline regression (depends: none; verifies: R1).
- [ ] T2: Document the greeting (depends: T1; verifies: R2).
## Verification
T1/C1: node --test greeting.test.mjs must exit 0 and assert R1.
T2/C2: node --test greeting-doc.test.mjs must exit 0 and assert R2.
```

`specs/greeting/checklist.md`

```text
# Acceptance checklist
## Acceptance
- [ ] C1: Greeting is correct (requirements: R1; verification: node --test greeting.test.mjs).
- [ ] C2: Example matches (requirements: R2; verification: node --test greeting-doc.test.mjs).
## Execution Approval
Pending; caller must approve this exact package and current scope.
## Verification
Not run yet; all task and checklist items remain unchecked.
```

## Progress and failure behavior

Inspect relevant implementation/tests after reading all three files, implement in dependency order and use actual project checks, tests first where practical. Existing checkmarks require current evidence; never trust stale progress. **Both tasks and checklist items remain unchecked until their applicable checks actually succeed.** This is deliberately stricter than upstream's implementation-only task rule.

Record exact commands, cwd, exit/outcome, check mapping and relevant output in the selected package. Keep `passed`, `failed`, `not-run` separate. A command must actually execute, finish with exit 0 and meet acceptance before it counts; nonzero exits, skipped checks, pending background jobs, rejected results and cancellations do not pass. Background execution is optional; collect final results by job ID before updating progress. No unrelated passing check completes other items.

On failure retain unchecked original items, failure evidence and concrete repair tasks; fix in scope and rerun. Keep failure/repair history even after successful repair. Report approved path, changed files, task/check counts, exact results, remaining work and questions, honestly distinguishing partial from complete execution.

## Verification boundaries

[Verification record](VERIFICATION.md) documents hands-on and offline scripted rehearsals. `test/spec-run.test.mjs` uses the public DSH AgentLoop testkit with a local scripted adapter, real fixture reads/edits and local Node checks; it does not call a paid model or implement a product runner. Those deterministic traces exercise workflow/tool-result handling, not arbitrary-model comprehension or enforceable security. No packed installation, active/disposable profile or TUI-support claim is made for this asset.

```sh
node --test --test-concurrency=2 test/spec-run.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
```

## Source and license

Adapted from codeasier's [spec-run](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-run.md) and [spec-write](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-write.md) at fixed revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`. Copyright (c) 2026 codeasier, [MIT](../../LICENSE); the complete upstream notice is retained in the standalone Skill. DSH-specific tool/confirmation guidance and verified-before-checking progress rules are migration changes. No OpenCode transport, polling or permission-compatibility code is copied.
