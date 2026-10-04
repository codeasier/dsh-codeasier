# spec-write

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

An implementation-ready three-file spec package, never product implementation.

## Usage and prerequisites

Load [SKILL.md](SKILL.md) explicitly through a separately configured DSH Skill discovery setup; these repository assets do not install themselves. The descriptor is `kind: skill`, not a native Loader entry, bundle patch or TUI Component manifest. This migration adds no backend or installer and changes no active profile. The collection's native default remains legacy cross-review.

Use available DSH `read`, `glob`, `grep`, and authorized `edit`/`write` tools. `ask_user_question` requires the exact live root Agent and an answerer. A delegated caller returns pending decisions to the parent/root; absent, skipped or pending answers do not authorize anything. Tool availability and host policy remain prerequisites. These instructions are not an enforced filesystem sandbox or a guarantee of unattended/background safety.

Inspect existing packages and update the matching `specs/<change-id>/` package only. The only files are `spec.md`, `tasks.md`, `checklist.md`: observable requirements/scenarios/scope, dependency-ordered tasks and verification, acceptance checks and the execution-approval boundary. The example uses draft/pending and R1/T1/C1; equivalent existing clear mappings need no metadata rewrite. File approval claims are not authorization. Read all three back, report blockers, request review, and stop without implementing code.

See [Three-file example and minimum contract](resources/package-example.md).

## Verification and limits

[test/workflow-skills.test.mjs](../../test/workflow-skills.test.mjs) loads these instructions into the public DSH production AgentLoop with an offline scripted adapter, executes fixture reads/writes/questions, and asserts actual outputs, zero-write/approval boundaries and failure cases. [The rehearsal record](../../docs/workflow-skills-verification.md) distinguishes behavior runs from static asset checks. Scripts follow the instruction paths; they do not prove that arbitrary models obey prompts, add native enforcement, or verify packaged/profile discovery. No paid provider, installation or release is used.

## Attribution

Adapted from [codeasier/open-codeasier `spec-write`](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-write.md), fixed revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`. The upstream workflow sources have no external resource files for these four Skills; handoff's inline template is retained as a local resource, and other working templates/examples are DSH adaptations. Copyright (c) 2026 codeasier. The full [MIT notice](LICENSE) is retained. No OpenCode transport, polling or permission-compatibility layer is copied.
