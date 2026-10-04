# understand-me

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

逐项提问、依赖有序的决策与显式共识确认。

## 使用与前置条件

通过单独配置的 DSH Skill 发现方式显式加载 [SKILL.md](SKILL.md)；仓库资源不会自行安装。描述符为 `kind: skill`，不是原生 Loader 入口、bundle patch 或 TUI Component 清单。本迁移不新增后端／安装器，不修改活动 profile。原生集合默认仍保持 legacy cross-review。

使用可用的 DSH `read`、`glob`、`grep` 以及已授权的 `edit`／`write` 工具。`ask_user_question` 要求精确的 live root Agent 和应答器。委派调用方把待确认决策交回父代理／根代理；缺失、跳过或 pending 回答都不是授权。工具可用性与宿主策略始终是前置条件。这些指令不是强制文件系统沙箱，也不保证无人值守／后台安全。

先读用户提供的证据。每次只问一个问题，给出推荐答案和理由；根据真实回答更新决策树，再请求共识确认。推荐与共识均不授权实现。委派调用方将待确认问题交回父代理／根代理。

参见[决策工作笔记](resources/decision-tree.md)。

## 验证与限制

[test/workflow-skills.test.mjs](../../test/workflow-skills.test.mjs) 将这些指令加载到公开 DSH 生产 AgentLoop，通过离线脚本适配器实际执行夹具读写／问答，断言输出、零写入／授权边界和失败场景。[演练记录](../../docs/workflow-skills-verification.zh-CN.md)区分行为运行与静态资产检查。脚本按指令路径演练，不证明任意模型遵守提示，不增加原生强制边界，也不验证打包／profile 发现能力。没有付费 provider、安装或发布。

## 来源与署名

改编自 [codeasier/open-codeasier `understand-me`](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/understand-me.md)，固定修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`。这四项上游工作流源文件没有外部资源；handoff 的内嵌模板保留为本地资源，其他工作模板／示例为 DSH 适配新增。Copyright (c) 2026 codeasier。保留完整 [MIT 声明](LICENSE)。未复制 OpenCode 传输、轮询或权限兼容层。
