# spec-write

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

可实施的三文件规格包，绝不实现产品代码。

## 使用与前置条件

通过单独配置的 DSH Skill 发现方式显式加载 [SKILL.md](SKILL.md)；仓库资源不会自行安装。描述符为 `kind: skill`，不是原生 Loader 入口、bundle patch 或 TUI Component 清单。本迁移不新增后端／安装器，不修改活动 profile。原生集合默认仍保持 legacy cross-review。

使用可用的 DSH `read`、`glob`、`grep` 以及已授权的 `edit`／`write` 工具。`ask_user_question` 要求精确的 live root Agent 和应答器。委派调用方把待确认决策交回父代理／根代理；缺失、跳过或 pending 回答都不是授权。工具可用性与宿主策略始终是前置条件。这些指令不是强制文件系统沙箱，也不保证无人值守／后台安全。

先检查既有包，仅更新匹配的 `specs/<change-id>/`。唯一文件为 `spec.md`、`tasks.md`、`checklist.md`，分别包含可观察需求／场景／范围、依赖有序任务及验证、验收检查及执行授权边界。例子用 draft/pending 和 R1/T1/C1；既有清晰映射无需为元信息重写。文件自称批准不是授权。回读三文件，报告阻塞项，请求审阅后停止，不实现代码。

参见[三文件示例与最低契约](resources/package-example.md)。

## 验证与限制

[test/workflow-skills.test.mjs](../../test/workflow-skills.test.mjs) 将这些指令加载到公开 DSH 生产 AgentLoop，通过离线脚本适配器实际执行夹具读写／问答，断言输出、零写入／授权边界和失败场景。[演练记录](../../docs/workflow-skills-verification.zh-CN.md)区分行为运行与静态资产检查。脚本按指令路径演练，不证明任意模型遵守提示，不增加原生强制边界，也不验证打包／profile 发现能力。没有付费 provider、安装或发布。

## 来源与署名

改编自 [codeasier/open-codeasier `spec-write`](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-write.md)，固定修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`。这四项上游工作流源文件没有外部资源；handoff 的内嵌模板保留为本地资源，其他工作模板／示例为 DSH 适配新增。Copyright (c) 2026 codeasier。保留完整 [MIT 声明](LICENSE)。未复制 OpenCode 传输、轮询或权限兼容层。
