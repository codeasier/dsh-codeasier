# 文档索引

[English](README.md) | [简体中文](README.zh-CN.md) | [仓库概览](../README.zh-CN.md)

`dsh-codeasier` 是尚未发布的 DSH 原生插件集合。使用插件时从插件指南开始，迁移新功能时从开发指南开始。英文和简体中文文档的能力范围保持一致；API 名称、包入口和 CLI 命令不翻译。

| 主题 | English | 简体中文 |
|---|---|---|
| 仓库概览与开发检查 | [Overview](../README.md) / [Checks](../README.md#development) | [概览](../README.zh-CN.md) / [开发检查](../README.zh-CN.md#开发与验证) |
| cross-review 配置、工具与生命周期 | [Plugin guide](../plugins/cross-review/README.md) | [插件指南](../plugins/cross-review/README.zh-CN.md) |
| 逐项澄清与共识确认 | [understand-me](../plugins/understand-me/README.md) | [understand-me](../plugins/understand-me/README.zh-CN.md) |
| 只读审计与已授权文档修复 | [docs-governance](../plugins/docs-governance/README.md) | [docs-governance](../plugins/docs-governance/README.zh-CN.md) |
| 规范交接与确认后接续 | [handoff](../plugins/handoff/README.md) | [handoff](../plugins/handoff/README.zh-CN.md) |
| 不实现代码的三文件规格包 | [spec-write](../plugins/spec-write/README.md) | [spec-write](../plugins/spec-write/README.zh-CN.md) |
| 工作流 Skill 演练证据与限制 | [Verification](workflow-skills-verification.md) | [演练验证](workflow-skills-verification.zh-CN.md) |
| spec-run 已批准三文件包与验证后进度 | [Skill guide](../plugins/spec-run/README.md) | [Skill 指南](../plugins/spec-run/README.zh-CN.md) |
| issue-review 证据分析与确认评论（纯 Skill） | [Review guide](../plugins/issue-review/README.md) | [Issue 评审指南](../plugins/issue-review/README.zh-CN.md) |
| issue-submit 模板、必填字段与确认投稿（纯 Skill） | [Submission guide](../plugins/issue-submit/README.md) | [Issue 投稿指南](../plugins/issue-submit/README.zh-CN.md) |
| 插件集合架构与兼容策略 | [Architecture](architecture.md) | [架构说明](architecture.zh-CN.md) |
| 新增插件、Skill 资源与 OpenCode 迁移 | [Development and migration](plugin-development.md) | [开发与迁移](plugin-development.zh-CN.md) |
| 公开契约、验收与安全边界 | [Contracts](contracts.md) | [契约与验收](contracts.zh-CN.md) |
| 可选 TUI Component 准入缺口 | [TUI admission gap](tui-admission-gap.md) | [TUI 准入缺口](tui-admission-gap.zh-CN.md) |

## 阅读与维护边界

```sh
pnpm run test:docs
```

这个离线回归检查当前中英文页面配对、已编写的行内相对链接与标题锚点、可执行示例和打包白名单。它不验证远程 URL，也不替代 docs-governance 对 README 篇幅、声明和翻译质量的实质审查。`pnpm run check` 已包含这些测试。

- 已验证原生能力的 gate 为 `test:dsh-profile`；更严格的中介命令与报告场景 `test:tui-profile` 单独保留，在已检查的固定版本中尚未满足。
- 插件脚手架不等于实现完成。纯 Skill 资源不会注册原生后端，也不会自行安装。
- 修改功能或支持范围时，同步更新对应的中英文版本和本索引。不翻译标识符，不省略安全条件，也不将历史 registry 标签表述为当前兼容保证。
- README 是入口；插件特有的组合配置位于插件指南，实现契约位于验收矩阵，可选集成限制有单独的说明页。保留已有的外部引用文档路径。
- 文档治理 audit 按照 [DSH docs-governance 指令](../plugins/docs-governance/SKILL.md)（保留上游署名）检查 README 篇幅、导航、相对链接与锚点、本地化，以及文档与包元数据、CLI 入口和实现的一致性。结构调整、删除或重命名外部引用路径需要确认，单纯 audit 不授权这些修改。
