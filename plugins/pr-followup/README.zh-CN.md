# pr-followup

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

针对一个明确 PR 的独立 [Skill 指令资源](SKILL.md)：完整读取反馈，以证据分类为有效、无效、重复或歧义，执行最小本地修复并记录检查，对远端操作分别确认。不增加 Host 入口、Cordis patch、TUI 适配器、后台执行、自动安装或通用工作流引擎。Skill 提示词不能强制执行边界、授权、取消或恢复；实际 DSH Host 策略和调用者始终具有决定权。

## 前置条件与范围

- 调用者具备 `read`、`glob`、`grep`、有界 `bash`、精确 `edit`/`write`，需要决策时能调用 `ask_user_question`；具备 Git 和实际发现的项目检查命令。
- 目标必须是一个 PR URL 或 forge/仓库/编号，具备 forge 认证读取权限，以及经过核验的元信息、review threads 与其嵌套评论、reviews、行内及普通评论、关联 issue 和分页接口。缺失权限要记录为不完整，不能当作没有反馈。
- [GitHub 读取配方](resources/github-reading.md) 仅适用于现有、已认证的 `gh` 接口。其他 forge 要独立核验契约；不宣称存在多平台适配器。cross-review 的公开 PR 元信息不读取完整反馈。
- 核对实际 PR base/head 的仓库、ref 和 SHA 与 Git 对象；明确移除上游固定 main 假设。保护已有 staged/unstaged/untracked 用户修改及 index。
- 回复、resolve thread、普通 push、rebase 和 force-push 都要新鲜、精确的预览和操作特定确认。取消或缺少确认意味着零对应操作。确认不能覆盖 Host 拒绝。委派调用者把待确认预览交回有权确认的调用者。
- 远端写响应不确定时，要针对具体资源读回核验，不能盲目重试。回复草稿、未解决和歧义反馈明确记录在[报告模板](resources/report-template.md)。

原生 DSH Skill 目录的发现或安装是单独的显式操作。`plugin.json` 是仓库元数据，不是原生激活声明。挂载 bundle 不会安装该 Skill。此资产的打包和临时 profile 安装**尚未验证**；本地测试不能形成发布或 profile 支持承诺。

## 离线行为验证

```sh
node --import tsx --test --test-concurrency=2 test/pr-followup.test.ts
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
pnpm run build
pnpm run test:types
```

[行为回归](../../test/pr-followup.test.ts) 使用公开 DSH `0.2.0-rc.2` AgentLoop testkit，显式脚本化离线 LLM 适配器、本地 HTTP forge 响应，以及临时真实 Git 仓库和 bare remote。演练非 main 的 PR base、认证读取、外层及嵌套分页、四种反馈分类、真实 Node 回归先失败后通过、仅提交一个文件且保留用户文件和 index、接口或认证不可用（包括 REST 第二页失败和 GraphQL 嵌套读取返回部分结果）、head 变化后废弃陈旧确认、缺少/取消/拒绝/不可用确认时零写操作、确认后仍被原生 Host guard 拒绝，以及不确定写响应在本地 HTTP 读回收据而不重复提交。写操作演练只使用本地夹具收据或计数器，绝不操作真实 PR。不挂载付费 provider。

脚本化 transcript 是契约演练，**不能**证明任意模型都会遵守 Skill，也不是后端强制安全保证。描述符只有在适用离线行为演练通过后才改为 `implemented`；该状态只描述指令迁移，不代表原生 runtime 或 profile 验收。成功的 `gh api user` 或 issue 读取不能证明真实 thread 读取或写能力。

## 来源、保留许可与迁移差异

改编自 [codeasier/open-codeasier workflow-source/skills/pr-followup.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/pr-followup.md)，固定修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`。Copyright (c) 2026 codeasier；完整保留上游 [MIT 声明](LICENSE)。不复制 OpenCode 传输、轮询或权限兼容层。

保留可移植任务本身；DSH 改编明确实际调用者工具，并增加真实 base/ref/SHA 绑定、普通评论和嵌套分页、接口不可用处理、四类反馈分类、用户修改保护、普通 push 单独确认、Host 拒绝优先、委派交接和不确定写响应核验。集合边界见[插件迁移指南](../../docs/plugin-development.zh-CN.md)。
