# cross-review-audit

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

独立、显式启用的 **DSH 原生 Host** 插件，审计一个明确指定、属于调用者的 cross-review 运行。后端已实现，不是 Skill-only 替代品；尚未发布。仅依赖原生工具和现有类型化 [CrossReviewService](../../src/plugins/cross-review/service.ts)，不依赖 TUI/React，不读取私有运行存储或会话数据库。

## 组合与调用

聚合及[独立 patch](cordis.patch.yml) 都默认 `disabled: true`；[描述文件](plugin.json) 是仓库元数据，不是原生 Component 准入清单。只能选择一个插入来源。现有 [cross-review Host](../cross-review/README.zh-CN.md) 必须另行挂载并配置；audit 不授权或启动评审。对于已经组合的聚合 bundle，显式 overlay 的格式如下（不是安装命令）：

```yaml
- id: cross-review-audit
  disabled: false
  config: {}
```

由确切、存活的所有者 Agent 调用原生工具，输入为：

```json
{ "runId": "00000000-0000-4000-8000-000000000001" }
```

调用 `cross_review_audit`。上面的 UUID 仅展示格式；必须替换为现有、属于调用者的完整 run ID，不能用前缀或会话 ID。未知输入和配置字段会被拒绝。[调用指令](SKILL.md) 是可选的可移植资源，不自行安装或注册后端。不宣称另有斜杠命令或 TUI 适配器。

## 观察契约

只调用 `status(agent, runId)` 和 `report(agent, runId)`。现有服务验证确切存活 Agent、会话/项目与运行时所有权，存储在返回前验证记录与证据。Audit 不列举所有会话，不读取原始存储，不调度工作、修改修订号、取消/恢复/清理运行、重放评审者，也不调用付费裁判/模型。既有 schema、aliases、授权和恢复契约保持不变。释放时仅注销 audit 工具，不释放 cross-review。

每项检查包含稳定的 `id`、`result`、具体 `facts`、`sources` 和限定范围的 `detail`。输出绑定 `binding: {runId, revision, snapshotId}`；获得 report 时另列 `reportBinding`。检查范围为：

- 运行/尝试/评审者及确切 child 身份唯一性，持久化 controller/snapshot 绑定，已确认结果，以及与配置精确一致的 provider/model 路由；
- 不可变快照哈希/路径/来源验证，一次性授权 digest/policy，生效配置及字段来源；
- 修订/墙上时钟观察、取消意图、恢复中断/不重放，以及待决超时/恢复决策；
- 已确认结果的严格多数门槛、规范化且唯一的裁决、已确认模型裁判决策、证据绑定的拒绝/待决问题、终态完成及派生报告一致性。

`pass` 仅验证已指明的持久化/派生事实。`anomaly` 表示有证据的矛盾。`insufficient-evidence` 表示比较或来源信息不完整。`cannot-verify` 表示现有公开契约无法证明（包括未知 schema/policy 版本）。这些都不是 finding 质量评分或正确性投票。

**并发读取：** status/report 各自读取当前记录。不同 revision 标记为 `insufficient-evidence`，不是一致性异常；不启动重试/轮询。读取之间发生 cleanup 时，保留已绑定 status 的审计，并明确 report 无法验证。Status 的所有权/存储读取失败作为原生工具错误返回，不伪造运行审计。纯检查器的异常/未知版本夹具独立验证诊断；真实存储可能在服务观察之前就拒绝这些记录，不能绕过校验。

**时钟不确定性：** 原生记录使用 `Date.now`，没有单调时钟保证。时间戳倒退或恢复未来时间记录标为 `insufficient-evidence`，不证明生命周期违约；不能由时间戳顺序推断修订历史内容。

**历史缺口：** 完成的原生 child 正常会被释放。Audit 不查询 registry 成员资格，不把缺失视为异常。两个服务方法不提供会话记录、已执行工具/请求历史、授权对话或 provider 费用，因此标记 `cannot-verify`。快照哈希证明内容完整性，不证明真实性。报告可包含不可变证据/结果中的事实，但不转储完整快照文件，不捏造会话或费用。

## 验证与交付边界

固定的离线契约依赖组：DSH `0.2.0-rc.2`、Cordis `4.0.4`、Node `22.22.3`、pnpm `11.21.0`。测试实际挂载 Host/工具，使用真实原生服务及审计期间拒绝模型调用的适配器，并通过显式脚本化离线运行验证真实原生 child 的正常释放，覆盖所有权/输入拒绝、依赖不可用、释放、无副作用重复读取、纯异常/未知版本夹具、真实持久化存储拒绝，以及并发的真实所有者控制。

```sh
pnpm run build
pnpm run test:types
pnpm run plugins:check
pnpm run test:plugins
pnpm run test:docs
node --import tsx --test test/cross-review-audit.test.ts
DSH_CODEASIER_AUDIT_PACKAGE_TEST=1 node --test test/cross-review-audit-package.test.mjs
```

单独的 `test/cross-review-audit-package.test.mjs` 使用隔离临时配置和现有依赖组，检查本地打包产物、导出/资源身份及公开原生 Loader 激活。这是**离线打包/Loader 检查**，不是生产依赖安装或完整公开 CLI profile gate。`test:package` 单独在仅安装生产依赖、不安装 React/TUI 的环境验证打包的 audit 入口和资源解析；不激活完整 CLI profile。`test:dsh-profile` 和 `test:tui-profile` 仍独立保留；不宣称 audit 专属真实 CLI profile/TUI 验收、活动 profile 安装、发布或真实付费评审通过。参见[原有验收边界](../../docs/contracts.zh-CN.md)。

## 来源署名与迁移

语义范围及调用指令改编自 [codeasier/open-codeasier，固定修订 20194ff7a7b26fd51965e50bdb5091cb37a4c0f5](https://github.com/codeasier/open-codeasier/tree/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5)：[audit.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/cross-review/audit.ts)、相关 audit-checks/project/types 模块及 [SKILL.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/skills/cross-review-audit/SKILL.md)。MIT，Copyright (c) 2026 codeasier；[保留的许可证](LICENSE)。

实现针对 DSH 所有权验证服务和不可变证据重写，不复制 OpenCode transport、run-store、会话投影、轮询次数或 P0–P3 评分。不合成会话/消息证据。迁移将显式父会话选择替换为一个属于调用者的完整 run UUID，保留证据不足与无法验证的诚实区分。
