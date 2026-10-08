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

## 初始化与可选 Skill 入口

原创的 [cross-review Skill](SKILL.md) 指引原生初始化或评审，不替代后端，也不改变 `/review`。只有通过已验证的 DSH 公开机制、另行得到用户明确授权并安装 Skill 后，`/cross-review` 才是可用 Skill。加载 bundle 或仓库元数据不会安装它；这里不承诺安装命令或 TUI 准入。[cross-review-audit](../cross-review-audit/README.zh-CN.md) 仍是独立的只读审计身份。

Skill 将首参数 `setup`/`init` 和明确的自然语言初始化意图路由到 setup，而不是评审。范围接受位置参数 `local`/`global` 或 `--local`/`--global`，默认 local，拒绝矛盾范围及未知标志/参数。缺失决策及保存确认由精确的 live runtime root 使用 `ask_user_question` 询问；子代理把待决问题交回该 root。

四个独立注册的原生工具完成初始化，不调用模型或创建评审者：

- `cross_config_catalog {}`：按 provider 分组列出全部已挂载 provider 和确切模型；推荐不等于自动选择路由。
- `cross_config_preview {scope, configuration}`：要求选择评审者，填充默认值，不写入文件，返回 `setupId`、`path`、`exists`、`configuration`、`effectiveConfig`、`sources`、`expiresAt`。
- `cross_config_save {setupId}`：显式人工确认后，在开放 turn 中请求原生授权，展示完整选择和确切的新建/替换路径；遵守宿主策略与拒绝。
- `cross_config_validate {scope}`：重读已保存文件，检查运行时 schema、生效配置、模型目录和精确解析；不是凭据或推理成功验证。

写入使用权限为 `0600` 的原生原子替换，拒绝不安全的符号链接/硬链接路径，并重新检查预览时的文件/配置层状态。配置文件必须是不超过 1 MiB 的有效 UTF-8 JSON。原子替换不保证崩溃持久性/fsync，也不构成对抗性文件系统隔离边界。

选择评审者的 `id`、`provider`、`model`、`focus`、可选 `maxTokens`、可选模型裁决者（否则由 parent 裁决）、并发与超时。原生默认并发为 `2`、超时为 `120000` ms、裁决者为 parent；评审者没有默认值。确认前预览完整选择、已有文件替换及生效覆盖。取消或缺少明确确认绝不保存。Setup 不调用 `cross_review_*`，不启动评审，不回退到通用文件系统/shell 写入，也不绕过无头/宿主授权策略。能力、读取、授权、写入或验证失败时停止并保留状态；已有畸形文件直接拒绝，不静默覆盖。写入后的验证失败不算初始化成功，也不授权回滚其他写入者的工作。

本地配置固定为所属 Agent 的**规范 cwd** 下的 `cwd/.dsh/cross-review.json`，全局配置固定为规范 `homedir/.dsh/cross-review.json`。**不向上搜索项目目录**：各 worktree 独立，证据目标不改变本地文件位置。这两个路径与 Host 私有运行存储 `root` 不同。

**本地评审之前：**现有 fail-closed 证据策略拒绝已修改或未跟踪的 `.dsh` 运行时文件，包括配置。在该 worktree 中，`cwd/.dsh/cross-review.json` 必须保持未跟踪并被 **Git 忽略**；添加忽略规则不会豁免已跟踪的运行时文件修改。Setup 验证检查配置，不证明评审证据捕获成功。Setup 绝不修改 `.gitignore` 或 `.git/info/exclude`，不暂存/取消跟踪文件，也不自动选择忽略策略；用户必须另行选择并授权该策略。项目外的全局配置不需要项目忽略步骤。其他已修改/未跟踪运行时文件仍会受到证据拒绝策略约束。

生效优先级：**默认值 < 全局文件 < 本地文件 < Host 覆盖 < 单次调用**。评审者数组整体替换，不拼接；模型裁决者字段在类型改变前合并，parent 清除模型裁决字段。Setup 预览展示文件/Host 生效层；单次调用覆盖在后续评审预览中展示。配置更新只影响新预览，不改变已冻结的预览/运行。初始化授权绝不等于付费评审授权。

**评审配置发现：**除非明确请求单次调用覆盖，否则在 `cross_review_preview {request:{target?, notes?, pack?}}` 中省略 `configuration`。后端会自动加载全局、本地文件及 Host 覆盖；不要求先校验文件。若手动检查已保存配置，`cross_config_validate {scope:"local"}` 报本地文件不存在时，必须继续调用 `cross_config_validate {scope:"global"}`，不得据此判定没有任何配置或要求重新选择评审者。缺失文件诊断仅标明所选作用域，并说明本次调用尚未检查另一作用域。即使两份文件都不存在，Host 或明确的单次调用设置仍可能提供评审者；只有原生预览在分层后报告缺少必需评审者时，才提供独立的 setup 交互。仅文件不存在允许继续发现：畸形、不可读或不安全文件，以及路由/模型目录错误，必须停止依赖操作，不得静默跳过或遮蔽。这不意味着已同意付费评审。

### 首次使用的两个坑

首次使用时，有两类条件可能阻止操作或遮蔽已保存的设置。

**所属会话的有效审批策略必须能够"询问"。** 当 profile 以审批策略 `never` 运行（常见的"完全访问、不弹审批"配置）时，保存配置与启动评审都无法进行：两者都要求为确切的选择或已冻结的付费计划取得一次原生 `allowed-once` 裁决，而 `never` 是拒绝，不是一揽子许可。两个阶段的诊断不同：

- `cross_config_save`: `never` 策略下返回 `Configuration authorization denied by host policy`；未挂载审批服务时返回 `Native configuration authorization is unavailable`。若服务已挂载但没有可用应答器，则返回 `Configuration authorization unavailable`。
- `cross_review_start`: `never` 策略下返回 `Review cost authorization rejected`；未挂载审批服务时返回 `Native startup authorization is unavailable`。若服务已挂载但没有可用应答器，则返回 `Review cost authorization unavailable`。`rejected` 也可能表示在 `ask` 策略下明确拒绝，因此不能仅凭报错认定有效策略。

审批策略与文件沙箱档位相互独立——这两件事都不受沙箱约束：Setup 通过 Host 自身的一次原子替换写入固定路径，启动则派发付费的提供方调用；所以沙箱全开并不能给出其中任何一项同意。请使用能够取得同意的会话权限档位，在有效策略为 `ask` 的会话中重试。挂载 `permission-presets` 的 profile（包括随附的基础 bundle）还需要兼容的预设组合：随附预设表没有 `danger-full-access`/`ask` 组合，因此仅修改 `approval` 行可能导致 `permission-presets` 拒绝挂载。若要保留完全访问沙箱，需另行配置匹配且能够询问的预设和 `defaultPreset`；选择会固定 `never` 的预设仍然无法取得同意。Setup 绝不修改 profile。绝不要用通用文件/shell 写入绕开该拒绝：手写的 `cross-review.json` 不携带 `allowed-once` 授权记录。无头预授权仍然要求 `ask` 以及一个单独组合、可信的原生应答器。

**Host 覆盖层优先于你刚保存的文件。** 在"默认值 < 全局文件 < 本地文件 < Host 覆盖 < 单次调用"的优先级下，若 profile 补丁里的 `cross-review` 行带有完整 `review` 块，Setup 可能保存并验证成功，但每个生效字段仍来自该覆盖层：预览与校验会逐键报告 `sources: host-plugin`，文件不改变任何行为。部分覆盖层仅遮蔽其提供的字段：Host 的 `concurrency` 覆盖可以优先，而文件中的评审者与超时仍然生效。在判断文件中的哪些设置生效之前，请对照 `effectiveConfig` 与逐字段的 `sources`，而不是你提交的 `configuration`。要让被遮蔽的文件字段生效，需要另行编辑或移除对应的覆盖字段；Setup 绝不触碰 profile。

## 工具与生命周期

- `cross_review_preview`：验证确切的模型路由和不可变证据，不调用模型。
- `cross_review_start`：在所属 Agent 的开放回合中进行原生审批；在权威成功结果之前不派发工作。
- `cross_review_status`、`cross_review_report`、`cross_review_evidence`：仅限所有者的只读观察。
- `cross_review_judge`、`cross_review_control`：独立验证，以及检查修订的控制/清理。

纯 DSH 可以提供 `/review`；TUI 的中介式 `/review` 是可选能力，目前仍被拒绝，并降级为原生工具使用指引。仅当 `report.complete === true` 时才表示完成。多数完成门槛（quorum）是一种完成策略，绝不是正确性的证明。并行评审会增加模型使用量和费用。

不可变证据、原生全新子代理和限定范围的执行 guard 均保持不变。恢复会复用已确认的结果、中断未知工作，绝不自动重放付费工作。本次仓库重组无需迁移存储数据。

## 验证

`test/cross-review-setup.test.ts` 使用离线夹具覆盖原生初始化注册、分作用域文件加载、确认/取消/释放、安全替换和运行时重读验证；`service.test.ts` 在保留证据排除策略的前提下检查文件/Host/单次调用优先级。这不等于已安装 Skill 发现或真实提供方推理验收。现有的 `test/{evidence,protocol,native-driver,service,store,judge,lifecycle-races,tui}.test.*` 仍是 cross-review 的验收测试。`test/plugin-repository.test.mjs` 验证集合布局/导出/补丁身份、脚手架安全性，以及原生禁用/释放语义。`test:package` 验证生产导出；`test:dsh-profile` 在隔离配置中验证受支持的原生行为。更严格的 `test:tui-profile` 仍是单独且尚未满足的验收关卡，不因重构而豁免。

参见[架构](../../docs/architecture.zh-CN.md)、[契约](../../docs/contracts.zh-CN.md)和[插件开发/迁移](../../docs/plugin-development.zh-CN.md)。这不意味着已经向活动配置安装、发布或进行付费评审。
