# dsh-codeasier

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](docs/README.zh-CN.md)

一个可扩展的 **DSH 原生插件集合仓库**。`cross-review` 是首个已实现的插件，包含完整 Host 后端和可选的 dsh-TUI 适配器。后续 Skill 和 OpenCode 功能可以独立迁移；本仓库不是 OpenCode API 兼容层。

## 插件仓库

采用一个 npm 包、多个独立原生插件入口和声明式 Cordis 组合，不引入新的运行时加载器或 Agent 引擎。

| 插件 | 规范入口 | 能力范围 |
|---|---|---|
| [cross-review](plugins/cross-review/README.zh-CN.md) | `dsh-codeasier/plugins/cross-review` | 原生评审、报告、控制、证据绑定与持久化恢复 |
| cross-review 可选 TUI | `dsh-codeasier/plugins/cross-review/tui` | 可选的公开 UI 能力；受宿主中介管理的命令准入仍有限制 |
| [spec-run](plugins/spec-run/README.zh-CN.md) | `plugins/spec-run/SKILL.md` | 纯指令：执行唯一批准的 spec 包，按依赖顺序、实际验证后更新任务/清单；不自动安装 |

```text
src/plugins/<id>/          # 插件自己的 Host/服务；可选 tui.ts
plugins/<id>/              # 描述文件、README、原生 patch 或 Skill 资源
scripts/                   # 本地插件目录校验与脚手架
src/host.ts, tui.ts, ...    # 旧入口兼容转发模块
cordis.patch.yml           # 仅包含 Host 的扁平聚合 bundle
```

```sh
pnpm plugins:list
pnpm plugins:check
pnpm plugin:new session-review
pnpm plugin:new handoff-notes --kind skill
```

先按下文明确安装开发依赖，再运行这些命令。脚手架明确标记为尚未实现；新的原生 patch 默认禁用，不会自动加入聚合 bundle。纯 Skill 资源不注册后端，也不会自行安装。这些命令只创建或检查仓库文件，不安装到活动 profile，也不调用模型。

现有 `dsh-codeasier`、`/tui` 和 `/protocol` 导出继续作为兼容别名。默认 bundle 仍然只包含 cross-review，保留原来的 Loader id/name、工具 ID 和持久化状态格式。**每个插件只能选择一套入口别名和 patch，不能同时挂载旧入口与新入口。** `plugins/<id>/plugin.json` 是仓库自有元数据，不是 DSH 原生 bundle 清单，也不是可选 TUI 的 Component 清单。

从[插件开发与迁移指南](docs/plugin-development.zh-CN.md)、[架构说明](docs/architecture.zh-CN.md)和 [cross-review 配置](plugins/cross-review/README.zh-CN.md)开始。

## 当前状态

**尚未发布的开发实现。** 仓库已包含后端、证据闸门、裁决、持久化恢复和可选适配器，不是仅有 Skill 的原型。目前不提供活动 profile 安装或发布承诺。原始交付以当时从 npm `latest` 选择的 DSH `0.2.0-rc.2` 能力为范围；这不是对现在移动 registry 标签的断言。[Issue #1](https://github.com/codeasier/dsh-codeasier/issues/1) 仍记录更广的路线图。验证边界见[契约与验收矩阵](docs/contracts.zh-CN.md)。已检查的原生 TUI 组合缺少 `/review` 所需的公开、清单感知的 Component 准入步骤；[已验证的集成缺口](docs/tui-admission-gap.zh-CN.md)记录了适配器自身激活上下文收到的拒绝和公开 API 边界。完整 TUI 验收尚未通过。

## 架构

```text
原生工具 / 人工命令                可选 TUI 适配器
              \                      /
                   CrossReviewService
                            |
          不可变证据 / 监督器 / 裁决 / 审计 / 恢复
                            |
               原生 DSH spawn 与类型化领域存储
```

- `dsh-codeasier/plugins/cross-review` 导出 Host 入口和类型化服务；其 `/tui` 入口可选。旧根入口转发到同一实现。Host 在运行时不导入 React 或 TUI。
- 评审者使用全新、一次性的原生子代理。每次尝试另有一个**不被驱动执行**的管理 Agent 提供明确的父身份；它从不调用模型。等待子代理创建钩子完成后，真实子代理 ID 才能与不可变证据持久化绑定，之后才能执行。
- 原生工具限制和单调执行守卫只允许快照读取与原生 `structured_output`。通用文件系统、shell、网络、MCP、委派、会话查询、作用域旁路和 `run_code` 都不能执行。评审者不会收到其他评审者的输出。
- 原生终态结果和后端定时器推进受限并发任务。状态读取不调度工作。只有终态且符合 schema 的结果才计入多数完成门槛；有效的空 findings 可以计入，部分输出不能计入。
- 父会话或显式配置的模型裁决会检查快照引文、去重规范化问题，并记录验证或拒绝。评审者投票不能证明问题正确。
- 一个持久化运行聚合保存配置及来源、快照字节及哈希、尝试和原生 ID、结果、待决事项、授权、修订号、取消意图和审计。贯穿完整生命周期的原生写锁保护实际存储根，范围仅为**同一宿主机 / PID 命名空间**；它不是分布式租约。

## 配置与调用

Host 要求绝对路径的私有本地 `root`，并显式指定评审者路由。下面是插件配置中的 `review` 层，而不是完整 Host 配置：

```json
{
  "reviewers": [
    { "id": "correctness", "provider": "YOUR_PROVIDER", "model": "YOUR_EXACT_MODEL", "focus": "Correctness and regressions", "maxTokens": 4096 },
    { "id": "security", "provider": "YOUR_PROVIDER", "model": "YOUR_EXACT_MODEL", "focus": "Security and evidence boundaries", "maxTokens": 4096 }
  ],
  "concurrency": 2,
  "timeoutMs": 120000,
  "judge": { "kind": "parent" }
}
```

这些都是示例占位值，不代表相应模型路由存在。Preview 检查已挂载的模型目录和精确解析结果，冻结生效配置并报告每个字段的来源。调用配置覆盖 Host 配置层；派发时不允许静默替换模型。

原生入口提供以下工具：

- `cross_review_preview`：在不调用模型的情况下准备 `{target?, configuration?, notes?, pack?}`。目标可以是本地修改、修订区间或公开 GitHub/GitCode PR URL。
- `cross_review_start`：获得原生启动成本授权后，消费一次 preview。
- `cross_review_status`、`cross_review_report`、`cross_review_evidence`：仅供所有者使用的只读观察，以及用于父会话裁决的不可变证据。
- `cross_review_judge`、`cross_review_control`：经过所有者与修订号检查的裁决、取消、超时保留或中止，以及终态清理。

已验证版本中的可用入口是原生 `cross_review_*` 工具链，有无 TUI 都可使用。拥有该运行的 Agent 可以依次 preview/start，再读取报告或控制运行。普通 DSH 也通过原生命令服务提供 `/review`。在 TUI 宿主中，可选适配器只有获得公开宿主准入后才尝试注册受宿主中介管理的 `/review`；当前检查的 TUI `0.12.0` 不会准入已安装的原生组合。适配器改为显示原生工具使用提示，不添加无归属的命令回退，也不绑定私有身份。命令的 `help` 动作说明共享的 JSON 参数语法。

### 授权与完成条件

启动必须发生在**真实、已打开的父 Agent turn** 中，因为原生授权要求这一条件。空闲命令不会伪造 turn 或修改策略；它拒绝启动并提示父 Agent 使用原生启动工具。只有 `allowed-once` 允许启动，且必须等启动工具的权威最终结果成功后才派发任务。`approval: never`、授权不可用、宿主拒绝、取消以及执行后结果被拒绝，都不会启动评审者。

显式 `preauthorizedDigests` 为无头集成记录一次性、精确匹配 preview 的应用授权。启动仍要求 `ask` 策略，以及**单独组合的可信原生机器应答器**返回 `allowed-once`；后端不会插入应答器来抢先覆盖拒绝或不可用机制。这些授权不能绕过 `never` 或原生工具策略拒绝。系统不估算费用，也不提供货币额度上限；授权内容会列明冻结证据、模型路由和配置的输出上限。测试不使用真实付费模型。

超时会停止未完成工作，并持久化 `preserve`/`abort` 决策。保留只能使用已确认的结果，仍须满足完成门槛和裁决要求，不会重启付费工作。父会话裁决在显式提交结论前一直待决。**只有 `report.complete === true` 才表示评审完整完成。**

恢复会验证快照完整性与原生绑定，复用已确认结果，并将未知尝试标记为 interrupted。它不会自动恢复未知付费调用，也不会静默替换模型。报告和快照保留到所有者授权清理为止；插件卸载会等待原生子代理、监听器、定时器和存储释放，不会安装任何内容到用户 profile。

## 证据限制

准备阶段对不支持的证据直接拒绝，而不是截断：二进制或非 UTF-8 数据、符号链接或子模块、不安全路径、已修改的凭据或运行时产物、带命令的 Git filter、过大的文件（8 MiB）或快照/差异（64 MiB）。补充 pack 不能替换仓库字节。支持公开 PR 元数据；私有或需认证的准备明确失败，不读取或发送凭据。本地捕获通过两次完整遍历检测修改，不是能抵御对抗性修改的操作系统原子文件系统快照。绑定完成后，评审者读取不可变内存，而不是变化中的工作区。SHA-256 提供内容完整性校验，不是带密钥的签名。

## 开发与验证

固定的公开原生 API 契约目标为 DSH `0.2.0-rc.2`，可选适配器目标为 dsh-TUI `0.12.0`。原始交付从当时 npm `latest` 选择这些版本；移动 registry 标签不是兼容保证。单独的 DSH `alpha` 系列不是默认支持目标。锁定依赖与实际契约测试共同确定验证范围，不能只看版本号。开发检查使用 Node `22.22.3` 和 pnpm `11.21.0`。请使用 pnpm：干净 npm 安装可能拒绝 TUI 包内打包的 `workspace:*` 依赖。工作区明确禁用依赖构建脚本以及 `pnpm run` 隐式安装；安装是单独的显式步骤。TUI 内置 working-activity 依赖声明较旧的 DSH/React peer；测试不会把这些警告伪装为完整 profile 兼容。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run test:contracts
pnpm run test:types
pnpm run test:docs
pnpm test
pnpm run check
```

测试使用临时 Git 仓库、隔离的状态/HOME、真实原生服务和脚本化离线适配器。不需要凭据、私有会话数据库、活动 profile 安装或付费评审。本地打包只用于验证，不是发布。

`pnpm run check` 默认跳过需要单独开启的打包和真实 TUI profile gate。构建后运行 `pnpm run test:package` 会本地打包，并在新的临时 HOME/store 中安装生产依赖，禁用依赖脚本；它需要 registry 访问，不依赖无关的开发者 npm 缓存。`pnpm run test:dsh-profile` 在真实、一次性的 DSH+TUI profile 中验证当前支持的原生评审、报告、修订控制和清理；只有明确的 fail-closed 诊断和原生工具提示同时出现，才接受可选命令被拒绝。`pnpm run test:tui-profile` 保留更严格、当前尚未满足的完整中介命令与报告场景验收。两个 profile gate 都要求 Node 22、Python 3、公开 DSH `0.2.0-rc.2` CLI 和本地构建的 tarball。临时 profile 会先固定并验证 pnpm `11.21.0`，不解析移动的 Corepack 默认版本。默认产物为 `.dsh-codeasier/package-acceptance/dsh-codeasier-0.0.0.tgz`（先构建、创建目录，再运行 `npm pack --ignore-scripts --pack-destination .dsh-codeasier/package-acceptance`）。`DSH_CODEASIER_TEST_CLI` 和 `DSH_CODEASIER_TEST_ARTIFACT` 可设为绝对路径以覆盖默认值。Gate 只安装到新建临时 HOME，显式对齐原生 AgentLoop 依赖组，禁用真实 provider 和无关 profile 功能，并在 PTY 中运行实际 TUI。只有证明受中介管理的 `/review` 注册、报告渲染、过期修订拒绝、清理和释放都成功，才能宣称完整 TUI 验收通过。

cross-review 实现为原创。可移植 Skill 文本改编自 [open-codeasier](https://github.com/codeasier/open-codeasier)，各资产记录固定来源并保留署名/许可证声明。没有复制 OpenCode 执行、轮询或权限兼容层。

## 许可证

[MIT](LICENSE)。
