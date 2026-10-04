# Documentation index

[English](README.md) | [简体中文](README.zh-CN.md) | [Repository overview](../README.md)

`dsh-codeasier` is an unreleased DSH-native plugin collection. Start with the plugin guide for usage or the development guide for migrations. English and Simplified Chinese pages have matching scope; API names, package entries and CLI commands are not translated.

| Topic | English | 简体中文 |
|---|---|---|
| Repository overview and development checks | [Overview](../README.md) / [Checks](../README.md#development) | [概览](../README.zh-CN.md) / [开发检查](../README.zh-CN.md#开发与验证) |
| cross-review configuration, tools and lifecycle | [Plugin guide](../plugins/cross-review/README.md) | [插件指南](../plugins/cross-review/README.zh-CN.md) |
| One-question clarification and consensus | [understand-me](../plugins/understand-me/README.md) | [understand-me](../plugins/understand-me/README.zh-CN.md) |
| Read-only audit and authorized documentation fixes | [docs-governance](../plugins/docs-governance/README.md) | [docs-governance](../plugins/docs-governance/README.zh-CN.md) |
| Canonical handoff and confirmed intake | [handoff](../plugins/handoff/README.md) | [handoff](../plugins/handoff/README.zh-CN.md) |
| Three-file specification without implementation | [spec-write](../plugins/spec-write/README.md) | [spec-write](../plugins/spec-write/README.zh-CN.md) |
| Workflow Skill rehearsal evidence and limits | [Verification](workflow-skills-verification.md) | [演练验证](workflow-skills-verification.zh-CN.md) |
| spec-run approved three-file packages and verified progress | [Skill guide](../plugins/spec-run/README.md) | [Skill 指南](../plugins/spec-run/README.zh-CN.md) |
| issue-review evidence analysis and confirmed comment (Skill-only) | [Review guide](../plugins/issue-review/README.md) | [Issue 评审指南](../plugins/issue-review/README.zh-CN.md) |
| issue-submit templates, required fields and confirmed submission (Skill-only) | [Submission guide](../plugins/issue-submit/README.md) | [Issue 投稿指南](../plugins/issue-submit/README.zh-CN.md) |
| One-issue worktree resolution, preservation and check evidence (Skill-only) | [issue-resolve](../plugins/issue-resolve/README.md) | [issue-resolve 指南](../plugins/issue-resolve/README.zh-CN.md) |
| pr-followup feedback triage, confirmations and offline rehearsal | [Skill guide](../plugins/pr-followup/README.md) | [Skill 指南](../plugins/pr-followup/README.zh-CN.md) |
| Opt-in cross-review-audit contracts, evidence gaps and calling instructions | [Audit guide](../plugins/cross-review-audit/README.md) | [审计指南](../plugins/cross-review-audit/README.zh-CN.md) |
| Plugin collection architecture and compatibility | [Architecture](architecture.md) | [架构说明](architecture.zh-CN.md) |
| Adding plugins, Skill assets and OpenCode migrations | [Development and migration](plugin-development.md) | [开发与迁移](plugin-development.zh-CN.md) |
| Public contracts, acceptance and safety boundaries | [Contracts](contracts.md) | [契约与验收](contracts.zh-CN.md) |
| Unresolved optional TUI Component admission | [TUI admission gap](tui-admission-gap.md) | [TUI 准入缺口](tui-admission-gap.zh-CN.md) |
| session-review public reads, evidence completeness and follow-up scope (investigation only) | [Investigation](session-review-investigation.md) | [调查报告](session-review-investigation.zh-CN.md) |

## Reading and maintenance boundaries

```sh
pnpm run test:docs
```

This offline regression checks the current English/Chinese page pairs, authored inline relative links and heading anchors, executable examples and the package allowlist. It does not validate remote URLs or replace a substantive docs-governance audit of README weight, claims or translation quality. `pnpm run check` includes these tests.

- The verified native capability gate is `test:dsh-profile`; the stricter mediated-command/report-scene `test:tui-profile` remains separate and unmet on the inspected pinned versions.
- Plugin scaffolds are not completed implementations. Skill-only assets do not register a native backend or install themselves.
- Keep each English/Chinese pair and this index in sync when changing functionality or supported scope. Do not translate identifiers, quietly drop safety qualifications, or promote historical registry tags to current compatibility claims.
- README is the entry point; plugin-specific composition lives in its guide, implementation contracts in the acceptance matrix, and the optional integration gap in its dedicated page. Existing externally referenced documentation paths are retained.
- Governance audits follow the [DSH docs-governance instructions](../plugins/docs-governance/SKILL.md) (with retained upstream attribution) and check README weight, navigation, relative links/anchors, localization and factual consistency against package metadata, CLI entrypoints and implementation. Fixing structure, deleting or renaming externally referenced paths requires confirmation; an audit alone does not authorize those changes.
