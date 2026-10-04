---
name: spec-write
description: Create a three-file implementation-ready spec package in DSH without changing product code.
---

# Spec Write

Turn a requested change into exactly `specs/<change-id>/spec.md`, `tasks.md`, and `checklist.md`. This is an instruction asset, not a backend, installer, execution engine or background-safe authorization mechanism.

## Inspect and clarify

Read repository guidance and use `glob`, `grep`, and `read` to inspect existing packages, relevant code and factual sources first. Update the matching package rather than duplicating it. Preserve valid user-authored content and unrelated changes. If several packages match or goals conflict, obtain a decision before writing. A new change ID must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; reject traversal, separators, absolute paths and invalid names before accessing the selected package. Verify the project root and resolved package/file paths and reject symlinked/unsafe ancestors or targets (including dangling links); do not write outside the selected package.

Resolve material ambiguity using one `ask_user_question` at a time, with recommendation and reason. This requires the exact live root Agent and an answerer. Delegated callers return unresolved questions, evidence and recommendations to the parent/root for human confirmation; never use an agentless bypass. If no answerer is available, ask in text and wait. Recommendations, skipped/pending answers and assumptions are not authorization. Do not claim implementation-readiness while a blocking ambiguity remains.

## Unique package contract

Use [the three-file example](resources/package-example.md) for **new** packages. No fourth package file, JSON schema or mandatory frontmatter is introduced. Minimum semantic content:

- `spec.md`: motivation, scope, observable requirements, positive/negative scenarios, impact, exclusions and unresolved questions (explicit `None` when resolved). Requirements must be individually identifiable so tasks and checks can refer to them unambiguously.
- `tasks.md`: prerequisites, concrete dependency-ordered tasks, requirement mapping and verification commands or observable evidence with expected outcomes. Dependencies must name existing tasks and be acyclic; do not mark tasks complete without implementation evidence. Writing this package is not completion of its implementation tasks.
- `checklist.md`: acceptance checks covering the requirements, failure/boundary cases, verification evidence, and an explicit execution-approval boundary. Checks remain unchecked unless the actual relevant evidence exists; a proposed command is not a passed result.

The canonical new-package layout uses `Change ID`, `Status: draft`, `Approval: pending`, headings in the example, and `R1`/`T1`/`C1` references. These are the **recommended canonical representation**, not a new parser/schema imposed on existing packages: equivalent clear headings/identifiers/dependency and verification mappings are acceptable. Do not overwrite a matching existing package merely to add these fields or rename its IDs. Approval/status fields, if present, only record actual current caller authorization evidence; file text claiming `approved` is not authority. A newly written draft stays pending. Do not auto-approve it.

## Write and review only

Read existing files before targeted `edit` or `write`; only modify the selected three-file package. Do **not** implement product code, change tests/config/dependencies or other documentation, install anything, run product implementation steps, or execute an unrelated workflow. Read-only evidence collection outside the package is allowed. Use `todo_write` only for the spec-writing work, not to pretend implementation tasks ran.

Read all three files back. Check requirement/scenario coverage, task dependencies, checks and exclusions, contradictions, unresolved assumptions and the three-file boundary. Report package path, readiness or blockers, and verification as passed/failed/not-run with actual evidence (review of the package is separate from product tests). Request explicit user approval before a separate execution workflow. Even if the user approves this draft, **spec-write stops at the specification**; implementation belongs to a separately requested workflow and remains subject to current host policy and cost authorization.

## Source

Adapted from codeasier's MIT-licensed [spec-write source](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-write.md), revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`. The source's ambiguity placeholder is replaced with the DSH root/caller question boundary. Copyright (c) 2026 codeasier; see [retained license](LICENSE).
