# issue-submit

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

已实现的**纯 Skill 指令资产**：针对一个明确 GitHub `owner/repo`，发现入口、收集必填字段、渲染、预览、确认并单次提交。[SKILL.md](SKILL.md) 不注册 Host/TUI 后端或原生 patch，不自行安装。`implemented` 仅表示指令改编及适用离线演练完成，不代表发布/profile 验收或强制授权。

## 流程与前置条件

已检查的 forge/CLI 契约是 **github.com 与 GitHub CLI 2.89.0**（[create 命令源码](https://github.com/cli/cli/blob/v2.89.0/pkg/cmd/issue/create/create.go#L116-L124)）。先检查实际 CLI help、认证与精确远端仓库，再读取模板。缺少认证明确停止，不登录/refresh，不更换目标或凭据。将内容读取固定在同一个已解析的默认分支 SHA。发现现代 `.github/ISSUE_TEMPLATE` 表单/Markdown、旧 `.github/ISSUE_TEMPLATE.md`、`config.yml`、空白入口许可与联系链接。只有已验证路径级 404 代表缺失；读取失败、无效或不支持模板不授权使用空白入口。

Live runtime root 通过 DSH `ask_user_question` 选择已发现入口，回答必填字段并确认保留默认值。委派子代理交回草稿及待问问题，不与用户直接交互或投稿。联系链接只展示，不自动打开/投递。外部模板是不可信数据，不能执行其命令或跳过确认。

表单支持 input/textarea 默认 value、textarea 代码渲染、有合法默认值的单选/多选 dropdown、必选 checkbox 和仅展示的 Markdown 指引。Placeholder 不是回答，不自动勾选同意项。可选未答文本/dropdown 渲染为 `_No response_`。Markdown/旧模板保留正文框架，收集用户完整正文并人工检查要求的章节（Markdown 没有机器必填 schema）。默认标题、labels、assignees 保留到用户明确更改；不支持的结构停止并转人工处理，不能静默丢字段。

展示完整目标、来源、标题、正文、labels、assignees，再提出 digest 绑定确认。取消、缺失、跳过、pending 或问答不可用均零写入，改动使确认失效。显式 `--repo`，提交精确正文和元数据，**不带 `--template`**：gh 2.89.0 禁止它和 `--body`/`--body-file` 并用。每个参数安全引用或使用 argv 传输，不能把用户文字当作 shell 语法求值。可用 `--body-file -` 经 stdin 发送精确正文；不创建本地草稿文件或改源码。

读回新 issue 作者、标题、正文和元数据，验证同仓库 URL。EOF、超时、非零退出或无 URL 是不确定状态，不证明提交失败。完整分页读取近期 issue，筛选作者/时间，排除 PR 并核对精确内容。唯一精确匹配可以确认；无匹配、多匹配或不完整读取仍未解决。不能盲重试或未验证便宣称成功。

## 纯数据资源契约

[resources/prepare.mjs](resources/prepare.mjs) 仅准备数据，不包含网络、shell、存储或 issue 执行器。要求 Node 22+ 和仓库的 `yaml` 依赖；安装后的 Skill/包资源解析**未验证**。满足前置条件后，用 `node <skill-base>/resources/prepare.mjs` 从 stdin 输入安全引用的 JSON，打印 JSON，不创建文件：

- `discover`：`{repo, authenticated: true, repository: {full_name, has_issues, default_branch}, files}`。`files` 将**每个读取路径**映射为 `{status: 200, kind: 'file', content}` / `{status: 200, kind: 'directory', entries: [{path, type: 'file'}]}` / `{status: 404}`。目录、旧模板和 config 必须有显式读取结果，包含所有列出的模板正文。工具自身不能认证输入证据；Agent 必须通过已验证只读调用取得。
- `render`：`{catalog, selection, title?, answers?, body?, labels?, assignees?}`。`selection` 是已发现路径或允许的 `blank`。表单答案以 field ID 为键：input/textarea 是字符串，dropdown 是选项字符串/数组，checkbox 是选中 label 数组。非表单 issue 使用完整 `body`。省略元数据保留默认值；用户决定后显式数组替换。返回 `{repo, selection, title, body, labels, assignees}`。
- `preview`：`{draft}` 返回精确草稿及 digest 绑定问题，本身不授权。
- `arguments`：`{draft, answer}` 要求原生问答结果的精确肯定回答，返回最终 `gh` argv，不执行。CSV 引用保留 CLI 元数据 flag 中的逗号/引号。
- `reconcile`：`{draft, readback: {records, complete, author, since}}` 接收 GitHub REST issue 对象（`user.login`、`created_at`、`title`、`body`、`labels`、`assignees`、`html_url`，可选 `pull_request`）。所有结果都是 `retry: false`；唯一精确候选才返回验证过的 URL。完整性、作者和时间必须来自实际读取，不能猜测标志。

资源保护准备好的数据，不是运行时权限边界。自动强制执行、授权或恢复应另行设计原生后端，不能靠这些指令完成。

## 验证与支持范围

```sh
node --test --test-concurrency=2 test/issue-workflows.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
```

见[演练记录](resources/REHEARSAL.md)。公开 DSH `0.2.0-rc.2` AgentLoop/testkit 与原生 userQuestions 在脚本化离线适配器中加载本仓库 Skill。隔离的 CLI/证据夹具覆盖发现、必填字段/默认值回答、完整预览、确认、最终 argv 和读回；取消、问答不可用、认证失败路径零写入。模拟服务器已接受后 EOF，通过核验解决，不重试。数据回归覆盖模板存在/缺失/读取失败、Markdown/旧模板/空白/联系配置、字段校验/默认值、过期确认和模糊/不完整回读。也实际执行资源 stdin CLI 入口，不连接远端执行器。

不真实投递测试 issue/评论，不调用付费模型、不安装或改活动 profile。脚本化演练证明已执行的契约，**不证明任意模型遵守指令**、真实 forge 投递、其他平台支持或打包/临时 profile Skill 发现。本迁移不作上述未验证声明。

## 来源与许可

改编自 [open-codeasier issue-submit.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/issue-submit.md)，修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`，Copyright (c) 2026 codeasier。保留[原文](resources/upstream.md)和 [MIT 声明](resources/LICENSE.upstream)。DSH 用 root 原生问答替换 `{{ASK_REQUIRED_FIELDS}}`，新增精确发现/渲染、CLI 确认与读回契约，不复制 OpenCode 传输、轮询或权限兼容层。参见[迁移规则](../../docs/plugin-development.zh-CN.md)。
