# Documentation index

[English](README.md) | [简体中文](README.zh-CN.md) | [Repository overview](../README.md)

`dsh-codeasier` is an unreleased DSH-native plugin collection. Start with the plugin guide for usage or the development guide for migrations. English and Simplified Chinese pages have matching scope; API names, package entries and CLI commands are not translated.

| Topic | English | 简体中文 |
|---|---|---|
| Repository overview and development checks | [Overview](../README.md) / [Checks](../README.md#development) | [概览](../README.zh-CN.md) / [开发检查](../README.zh-CN.md#开发与验证) |
| cross-review configuration, tools and lifecycle | [Plugin guide](../plugins/cross-review/README.md) | [插件指南](../plugins/cross-review/README.zh-CN.md) |
| Plugin collection architecture and compatibility | [Architecture](architecture.md) | [架构说明](architecture.zh-CN.md) |
| Adding plugins, Skill assets and OpenCode migrations | [Development and migration](plugin-development.md) | [开发与迁移](plugin-development.zh-CN.md) |
| Public contracts, acceptance and safety boundaries | [Contracts](contracts.md) | [契约与验收](contracts.zh-CN.md) |
| Unresolved optional TUI Component admission | [TUI admission gap](tui-admission-gap.md) | [TUI 准入缺口](tui-admission-gap.zh-CN.md) |

## Reading and maintenance boundaries

```sh
pnpm run test:docs
```

This offline regression checks the current English/Chinese page pairs, authored inline relative links and heading anchors, executable examples and the package allowlist. It does not validate remote URLs or replace a substantive docs-governance audit of README weight, claims or translation quality. `pnpm run check` includes these tests.

- The verified native capability gate is `test:dsh-profile`; the stricter mediated-command/report-scene `test:tui-profile` remains separate and unmet on the inspected pinned versions.
- Plugin scaffolds are not completed implementations. Skill-only assets do not register a native backend or install themselves.
- Keep each English/Chinese pair and this index in sync when changing functionality or supported scope. Do not translate identifiers, quietly drop safety qualifications, or promote historical registry tags to current compatibility claims.
- README is the entry point; plugin-specific composition lives in its guide, implementation contracts in the acceptance matrix, and the optional integration gap in its dedicated page. Existing externally referenced documentation paths are retained.
- Governance audits follow the [docs-governance instructions from open-codeasier](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/docs-governance.md) and check README weight, navigation, relative links/anchors, localization and factual consistency against package metadata, CLI entrypoints and implementation. Fixing structure, deleting or renaming externally referenced paths requires confirmation; an audit alone does not authorize those changes.
