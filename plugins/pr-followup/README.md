# pr-followup

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

An independent [Skill instruction asset](SKILL.md) for one explicit PR: complete feedback reading, evidence-based valid/invalid/duplicate/ambiguous classification, minimal local correction and check records, and individually confirmed remote actions. No Host entry, Cordis patch, TUI adapter, background execution, automatic installation or generic workflow engine is added. Skill prose cannot enforce execution boundaries, authorization, cancellation or recovery; effective DSH Host policy and the caller remain authoritative.

## Prerequisites and scope

- A caller with `read`, `glob`, `grep`, bounded `bash`, targeted `edit`/`write`, and `ask_user_question` when decisions are needed; Git and the project's discovered check commands.
- Exactly one PR URL or forge/repository/number, authenticated forge read access, and verified interfaces for metadata, review threads and nested comments, reviews, inline and ordinary comments, linked issues and pagination. Missing access is reported as incomplete, never as empty feedback.
- The [GitHub reading recipe](resources/github-reading.md) is conditional on an existing authenticated `gh` interface. Other forges need their own verified contracts; no multi-forge adapter is claimed. Cross-review public PR metadata does not read review feedback.
- Actual PR base/head repository, ref and SHA are checked against Git; the upstream fixed-main assumption is deliberately removed. Existing staged/unstaged/untracked user changes are preserved, including the index.
- Replies, resolve-thread, ordinary push, rebase and force-push each require an exact fresh preview and action-specific confirmation. Cancellation or absent confirmation means zero corresponding operations. Confirmation never overrides Host denial. A delegated caller returns pending previews to its authorized caller.
- Uncertain remote write responses trigger resource-specific read-back, not blind retry. Reply drafts and unresolved/ambiguous feedback remain explicitly recorded in the [report template](resources/report-template.md).

Discovery/installation into a native DSH Skill directory is a separate explicit operation. `plugin.json` is repository metadata, not native activation. Bundle mounting does not install this Skill. Packaging and disposable-profile installation of this asset have **not** been verified; no release or profile-support claim follows from local tests.

## Offline behavior verification

```sh
node --import tsx --test --test-concurrency=2 test/pr-followup.test.ts
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
pnpm run build
pnpm run test:types
```

[The behavior regression](../../test/pr-followup.test.ts) uses the public DSH `0.2.0-rc.2` AgentLoop testkit with an explicitly scripted offline LLM adapter, local HTTP forge responses and disposable real Git repositories/bare remotes. It exercises a non-main PR base, authenticated reads, outer and nested pagination, every feedback category, a failing-then-passing actual Node regression, a one-file local commit preserving user bytes/index, interface/auth unavailability (including failed REST second pages and partial GraphQL nested reads), stale-confirmation invalidation when the head changes, no writes on missing/cancelled/rejected/unavailable confirmation, native Host guard denial after confirmation, and uncertain-write local HTTP receipt read-back without resubmission. Write rehearsals use local fixture receipts/counters only, never real PR operations. No paid provider is mounted.

The scripted transcript is a conformance rehearsal, **not** proof that arbitrary models obey the Skill or a backend safety guarantee. Descriptor status is changed to `implemented` only after the applicable offline behavior rehearsal passes; that status describes the instruction migration, not native runtime or profile acceptance. Live thread retrieval/write capabilities are not inferred from successful `gh api user` or issue reads.

## Source, retained license and migration changes

Adapted from [codeasier/open-codeasier workflow-source/skills/pr-followup.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/pr-followup.md), pinned revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`. Copyright (c) 2026 codeasier; the upstream [MIT notice](LICENSE) is retained in full. No OpenCode transport, polling or permission layer is copied.

The portable task is retained; DSH adaptation names available caller tools and adds real base/ref/SHA binding, ordinary comments and nested pagination, unavailable-interface handling, four-way classification, protection of user changes, separate ordinary-push approval, Host-denial precedence, delegated handoff and uncertain-write reconciliation. See [plugin migration guidance](../../docs/plugin-development.md) for collection boundaries.
