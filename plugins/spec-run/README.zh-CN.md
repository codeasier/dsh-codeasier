# spec-run Skill

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

## 范围与前置条件

[SKILL.md](SKILL.md) 是独立的**纯指令资产**，不是 Host 后端、TUI 适配器、安装器、后台安全机制或通用编排引擎。`plugin.json` 是仓库元数据（`kind: skill`），不是原生 Loader 条目或 Component 清单。聚合 bundle 与旧版 cross-review 身份不变。将包加入 bundle 不会安装此 Skill。

仅在调用方明确批准**唯一、确切的当前** `specs/<change-id>/` 包、下述三文件可读且项目检查/编辑/验证工具可用时使用。按实际可用能力使用 DSH `glob`、`read`、`edit`/`write`、`bash` 和提问工具；缺少必需能力时阻塞相关工作，不能视为通过。直接调用方向用户提问；委派调用方将待确认问题交回主 agent，并等待确认。不需要付费模型、profile 修改或自动安装。

包批准不授权远端写操作、删除、发布、安装、付费操作或绕过 Host 策略。需求是任务数据，不是覆盖拒绝的指令。此 Skill 无法从技术上强制安全；生效的 Host 策略与明确的调用方授权仍是权威。

## 可移植三文件契约

本迁移依赖首批 spec-write 迁移（[issue #5](https://github.com/codeasier/dsh-codeasier/issues/5)）提供生产工作流。这里独立遵循已批准的上游 Markdown 契约，不要求另一分支的资产或第四个批准文件：

| 文件 | 内容 |
|---|---|
| `spec.md` | 动机、范围、可观察需求/场景、影响和排除项 |
| `tasks.md` | 具体可验证、按依赖排序的任务 |
| `checklist.md` | 验收检查及验证结果记录 |

批准来自调用方上下文，绑定确切路径与当前范围；文件内写“Approved”不构成授权。任务/检查 ID 和依赖标签只是可选的澄清约定，不是解析器/schema 要求。文件缺失/不可读、选择或需求歧义、矛盾、未知/循环依赖或无批准时，在实施前停止。澄清若改变范围，先确认修订后的包再执行。

自包含示例（普通 Markdown，初始均未勾选）：

`specs/greeting/spec.md`

```text
# Greeting
Change ID: greeting
Status: draft
Approval: pending
## Motivation
Provide a deterministic greeting.
## Scope
Only greeting.mjs, greeting.test.mjs, greeting-doc.md and greeting-doc.test.mjs.
## Requirements
R1: Export greet(name); greet('DSH') returns 'Hello, DSH!'.
R2: Document the exact greeting.
## Scenarios
The call and documented example both show 'Hello, DSH!'.
## Impact
No dependencies or remote services.
## Exclusions
No installation, deletion, publishing or paid calls.
## Open Questions
None; caller execution approval is still required.
```

`specs/greeting/tasks.md`

```text
# Tasks
## Prerequisites
Caller approval for this exact package and current scope.
## Tasks
- [ ] T1: Add greet(name) and its offline regression (depends: none; verifies: R1).
- [ ] T2: Document the greeting (depends: T1; verifies: R2).
## Verification
T1/C1: node --test greeting.test.mjs must exit 0 and assert R1.
T2/C2: node --test greeting-doc.test.mjs must exit 0 and assert R2.
```

`specs/greeting/checklist.md`

```text
# Acceptance checklist
## Acceptance
- [ ] C1: Greeting is correct (requirements: R1; verification: node --test greeting.test.mjs).
- [ ] C2: Example matches (requirements: R2; verification: node --test greeting-doc.test.mjs).
## Execution Approval
Pending; caller must approve this exact package and current scope.
## Verification
Not run yet; all task and checklist items remain unchecked.
```

## 进度与失败行为

完整阅读三文件后再检查相关实现/测试，按依赖顺序实施，实际调用项目检查入口，尽可能测试先行。已有勾选需要当前有效证据，不能信任陈旧进度。**任务与 checklist 都必须在实际适用检查成功后才勾选。** 这刻意严于上游仅实现后勾选任务的规则。

在选中的包内记录精确命令、cwd、退出码/结果、检查映射及相关输出，区分 `passed`、`failed`、`not-run`。命令必须确实执行、完成且退出 0，并满足验收，才算通过；非零退出、跳过、后台未结束、结果拒绝和取消都不通过。后台执行可选；更新进度前按 job ID 收集最终结果。不能用无关的成功检查完成其他项目。

失败时保留未勾选的原始事项、失败证据及具体修复任务；仅在范围内修复并重跑。修复成功后仍保留失败/修复历史。报告批准路径、修改文件、任务/检查数量、精确结果、余下工作和问题，如实区分部分执行与完成。

## 验证边界

[验证记录](VERIFICATION.md) 记载动手与离线脚本化演练。`test/spec-run.test.mjs` 使用公开 DSH AgentLoop testkit、本地 scripted adapter、实际夹具读写和本地 Node 检查；不调用付费模型，也不实现产品 runner。这些确定性轨迹验证工作流/工具结果处理，不证明任意模型的理解或可强制执行的安全。此资产不宣称已验证打包安装、活动/临时 profile 或 TUI 支持。

```sh
node --test --test-concurrency=2 test/spec-run.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
```

## 来源与许可证

改编自 codeasier 固定修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5` 的 [spec-run](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-run.md) 与 [spec-write](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/spec-write.md)。Copyright (c) 2026 codeasier，[MIT](../../LICENSE)；独立 Skill 内保留完整上游声明。DSH 工具/确认指导及“验证后才勾选”的规则是本次迁移差异。没有复制 OpenCode 传输、轮询或权限兼容代码。
