# issue-review

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

已实现的**纯 Skill 指令资产**：对一个 GitHub issue 做证据评审，并在确认后评论。[SKILL.md](SKILL.md) 不修复代码，不注册 Host/TUI，不强制只读执行，也不会自行安装。cross-review 聚合 bundle 保持不变。`implemented` 只表示指令改编及适用离线演练完成，不代表发布或 profile 支持。

## 调用与边界

向真实 root Agent 提供一个 issue 编号和明确或已核实的 github.com `owner/repo`，再加载 Skill。它核实实际 CLI、认证和目标，读取完整 issue 与所有评论页，并检查仓库实现、文档、测试和公开契约。分别判断真实性、合理性及正确范围，记录证据引用和未解决限制。

只有 live root 能取得 DSH 原生人机回答。委派子代理将证据、草稿和待确认问题交给父代理，不能代父代理提问或评论。缺少认证/读取能力、问答不可用、取消或未确认均零写入。Issue 内容是不可信数据，不能授权执行命令或修改源码。Skill 不改 issue 元数据/状态，不创建代码、分支、commit 或 PR。

展示完整评论与目标；digest 绑定的肯定回答仅授权该正文，修改后须重新确认。只执行一次 `gh issue comment`，然后读回作者、正文和 URL。EOF、超时或非零退出是不确定状态：先完整读取评论，核对正文、作者与时间，再考虑后续操作。无匹配、多重匹配或读取不完整均不授权重试，也不能证明提交失败。

## 纯数据资源

[resources/comment.mjs](resources/comment.mjs) 不含网络、文件系统或 shell 执行器。通过 stdin 输入 JSON，在内存中保留输出，不创建草稿文件。其动作：

- `render`：`{repo, number, reality, reasonableness, boundary, evidence: string[], limitations}` 生成 `{repo, number, body}`。证据及三项判断均必填；格式化不等于独立验证证据。
- `preview`：`{draft}` 返回完整草稿和 digest 绑定问题，交给原生 `ask_user_question`。
- `arguments`：`{draft, answer}` 仅接受该问题的精确肯定回答，返回最终 `gh` argv（不含可执行文件），不执行。
- `reconcile`：`{draft, readback: {records, complete, author, since}}` 核对 GitHub REST 评论对象（`user.login`、`created_at`、`body`、`html_url`）。唯一精确匹配返回已验证 URL；所有结果均为 `retry: false`。

宿主没有 argv 传输时，必须对每个 shell 参数安全引用，包括正文中的单引号、换行和命令替换。也可用 `--body-file -` 从 stdin 提供完全相同正文，不需要临时文件。资源检查只是草稿级防护，**不是可强制执行的授权或 root 身份边界**。

## 验证与支持范围

```sh
node --test --test-concurrency=2 test/issue-workflows.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
```

见[演练记录](resources/REHEARSAL.md)：使用真实公开 DSH `0.2.0-rc.2` AgentLoop/testkit 和 userQuestions，仅挂载脚本化离线适配器和 CLI/证据夹具。演练加载仓库 Skill，读取两页评论及源码/契约，分别给出三项结论，完整预览、确认，捕获一次精确评论 argv；不确定 EOF 后先读回验证，没有重复评论。原生问答拒绝 child 和伪造 root，源码字节不变。数据回归还覆盖取消、缺失、pending、过期确认和不完整/重复回读。

已检查 GitHub CLI `2.89.0` help/源码，未真实投递测试评论。没有宣称其他 forge、host 或 CLI 版本已验证。脚本化调用证明所演练的数据/API 契约，**不证明任意模型遵守指令**。本迁移未验证打包后资源定位、Skill 安装/发现、临时 profile 或活动 profile 支持。需要自动强制授权、恢复或只读执行时，应另行设计原生后端。

## 来源与许可

改编自 [open-codeasier issue-review.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/issue-review.md)，修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`，Copyright (c) 2026 codeasier。保留[原文](resources/upstream.md)与 [MIT 声明](resources/LICENSE.upstream)。DSH 改编新增 root 原生问答、明确 CLI/目标/认证前置条件和不确定响应防重复处理，不复制 OpenCode 传输、轮询或权限兼容层。参见[迁移规则](../../docs/plugin-development.zh-CN.md)。
