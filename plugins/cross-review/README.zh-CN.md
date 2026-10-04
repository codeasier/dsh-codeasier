# cross-review 插件

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

已实现但尚未发布的 **DSH 原生 Host 插件**。规范入口：`dsh-codeasier/plugins/cross-review`。
可选适配器：`dsh-codeasier/plugins/cross-review/tui`。旧版别名 `dsh-codeasier`、`dsh-codeasier/tui` 和 `dsh-codeasier/protocol` 仍然可用。

仅加载**一个** Host 入口，而不是同时加载两个名称：别名共享代码，但 Cordis 会为每个挂载条目创建独立激活。稳定的 Host Loader id 仍为 `cross-review`；现有存储根目录、记录模式和工具名称均不改变。

## 组合

软件包的 `dsh.bundle.patch` 选择仅含 Host 的根聚合入口。这保留了原始的 `name: dsh-codeasier` 行，包括按名称设置保护条件的用户覆盖。`plugins/cross-review/cordis.patch.yml` 是使用规范入口的独立替代方案。**不要同时组合两个补丁**：它们都会插入 `cross-review`，而原生组合不会替你拒绝重复条目。

配置使用原生 Loader 覆盖，而不是新的插件管理器设置：

```yaml
- id: cross-review
  config:
    root: /ABSOLUTE/PRIVATE/LOCAL/cross-review-state
    review:
      reviewers:
        - id: correctness
          provider: YOUR_PROVIDER
          model: YOUR_EXACT_MODEL
          focus: Correctness and regressions
          maxTokens: 4096
        - id: security
          provider: YOUR_PROVIDER
          model: YOUR_EXACT_MODEL
          focus: Security and evidence boundaries
          maxTokens: 4096
      concurrency: 2
      timeoutMs: 120000
      judge: { kind: parent }
```

这些是占位符，不是可工作的模型路由。原生补丁组合会**替换整个 `config` 字段**，不会对多个独立配置覆盖进行深度合并。应在一个有效配置中提供所有 Host 字段。`CrossReviewService` 内部的评审者配置分层是另一项经过验证的功能。

在覆盖中使用 `- id: cross-review` / `disabled: true` 可禁用整个插件。原生 Loader 会跳过导入/激活；不会创建评审工具、存储或计时器。证据、费用授权、执行 guard、裁决、审计和恢复是必需的内部机制，绝不能独立禁用。

可选的 `tui.patch.yml` 不在默认 bundle 中。它需要此 Host 和公共 TUI 服务；禁用 Host 时，应另行禁用其 `cross-review-optional-tui` 行。它是组合资源，不意味着 DSH 会自动发现每个插件的补丁，也不意味着带清单的 TUI Component 已获准入。软件包根目录的 `dsh-plugin.json` 仍然仅描述这个可选适配器。当前公共准入限制见[已验证的缺口](../../docs/tui-admission-gap.zh-CN.md)。

## 工具与生命周期

- `cross_review_preview`：验证确切的模型路由和不可变证据，不调用模型。
- `cross_review_start`：在所属 Agent 的开放回合中进行原生审批；在权威成功结果之前不派发工作。
- `cross_review_status`、`cross_review_report`、`cross_review_evidence`：仅限所有者的只读观察。
- `cross_review_judge`、`cross_review_control`：独立验证，以及检查修订的控制/清理。

纯 DSH 可以提供 `/review`；TUI 的中介式 `/review` 是可选能力，目前仍被拒绝，并降级为原生工具使用指引。仅当 `report.complete === true` 时才表示完成。多数完成门槛（quorum）是一种完成策略，绝不是正确性的证明。并行评审会增加模型使用量和费用。

不可变证据、原生全新子代理和限定范围的执行 guard 均保持不变。恢复会复用已确认的结果、中断未知工作，绝不自动重放付费工作。本次仓库重组无需迁移存储数据。

## 验证

现有的 `test/{evidence,protocol,native-driver,service,store,judge,lifecycle-races,tui}.test.*` 仍是 cross-review 的验收测试。`test/plugin-repository.test.mjs` 验证集合布局/导出/补丁身份、脚手架安全性，以及原生禁用/释放语义。`test:package` 验证生产导出；`test:dsh-profile` 在隔离配置中验证受支持的原生行为。更严格的 `test:tui-profile` 仍是单独且尚未满足的验收关卡，不因重构而豁免。

参见[架构](../../docs/architecture.zh-CN.md)、[契约](../../docs/contracts.zh-CN.md)和[插件开发/迁移](../../docs/plugin-development.zh-CN.md)。这不意味着已经向活动配置安装、发布或进行付费评审。
