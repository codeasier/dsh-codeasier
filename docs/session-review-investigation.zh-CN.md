# Session-review 公开读取契约调查

[English](session-review-investigation.md) | [简体中文](session-review-investigation.zh-CN.md) | [文档索引](README.zh-CN.md)

## 结论与范围

[Issue #11](https://github.com/codeasier/dsh-codeasier/issues/11) 是调查，**不是 session-review 插件实现**。固定 DSH `0.2.0-rc.2` / Cordis `4.0.4` 下，可信 Host 在**挂载具体 backend 后**，能通过公开 `ctx.sessionQuery` 读取一个明确指定的 live 或 persisted-not-loaded 会话。这不授予模型读取权限。本次不增加插件入口、scaffold、导出器、会话选择器、归档、删除或恢复操作；现有 cross-review reviewer 的 session-query 禁令保持不变。

实测环境：Node `22.22.3`、pnpm `11.21.0`、仓库基线 `52f64d752198311d4933273f0040974aab905338`。[离线契约测试](../test/session-query-contracts.test.mjs) `SQ1`–`SQ18` 同时检查已安装包的版本和实际调用结果。结论仅适用于这个固定组合与夹具，不外推所有 profile、历史格式或未来版本。

## 确切公开来源与服务组合

下列 DSH 包均固定为 **`0.2.0-rc.2`**。来源包括发布包根入口/公开 subpath、README 和类型声明；代码或类型存在本身不是实测结果。

| 来源代号 | 已发布接口/来源 | 使用与验证范围 |
|---|---|---|
| Q | [session-query README](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/README.md)、[公开类型](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/lib/types/index.d.ts)、[observation 契约](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/lib/types/observation.d.ts) | `readSession(id)`、`observeSession(id, options)`、`readSurface(id)`、`buildSessionEventRecords`、租约固定切点、类型化错误 |
| B | [session-query-sqlite README](https://unpkg.com/@deepseek-ai/dsh-session-query-sqlite@0.2.0-rc.2/README.md) | 真实具体 backend，`path: ':memory:'`；精确读取使用 `openAt: 'never'`，仅片段/分页测试使用 `startup` |
| S | [session 公开类型](https://unpkg.com/@deepseek-ai/dsh-session@0.2.0-rc.2/lib/types/index.d.ts)、[surface 契约](https://unpkg.com/@deepseek-ai/dsh-session@0.2.0-rc.2/lib/types/surface.d.ts) | 创建与追加会话；对 Q 返回的同切点事件使用公开 `foldSurface`、`deriveEventMessage`，不新增已弃用同步事件读取 |
| P | [persistence README](https://unpkg.com/@deepseek-ai/dsh-session-persistence@0.2.0-rc.2/README.md)、[JSONL backend README](https://unpkg.com/@deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2/README.md) | 真实隔离 JSONL backend，`compression: 'none'`；公开 `create/append/flush/close`、`open(id, 'read')/read`、`stat`，不读取私有 DB |
| F | [format catalog message-projections 公开出口](https://unpkg.com/@deepseek-ai/dsh-session-format-catalog@0.2.0-rc.2/lib/types/message-projections.js) | 同切点 fold 传入 `currentSessionMessageProjections`；仅证明实际测试过的记录 |
| L/T | [LLM message 类型](https://unpkg.com/@deepseek-ai/dsh-llm@0.2.0-rc.2/lib/types/message.d.ts)、[tools README](https://unpkg.com/@deepseek-ai/dsh-tools@0.2.0-rc.2/README.md)、[AgentLoop testkit](https://unpkg.com/@deepseek-ai/dsh-agent-loop-testkit@0.2.0-rc.2/README.md) | 真实生产 loop + 本地 `ScriptedLLM` adapter；工具渲染、失败记录和公开单调 `tools.guard` |
| C | [compaction README](https://unpkg.com/@deepseek-ai/dsh-compaction@0.2.0-rc.2/README.md)、[checkpoint 公开类型](https://unpkg.com/@deepseek-ai/dsh-compaction@0.2.0-rc.2/lib/types/checkpoint.d.ts) | 公开 compaction 形状的 bracket/checkpoint/replacement 夹具；**未执行**压缩摘要 backend |

`session-query` 是 `@deepseek-ai/dsh` 拥有的已安装 transitive public 依赖。测试采用[仓库已有公开解析先例](../test/plugin-repository.test.mjs)：`createRequire(require.resolve('@deepseek-ai/dsh/package.json'))`，再解析/导入各包公开入口。DSH 根入口未导出 main，首次用其作为解析锚点收到 `ERR_PACKAGE_PATH_NOT_EXPORTED`；改用公开 `package.json` 成功。不导入 private helper，不安装依赖，不修改共享 `node_modules`。后续产品功能应声明直接公开依赖，不能依赖本测试的 transitive 可用性。

精确读取组合为：Cordis Context → session 服务 → 可选 JSONL persistence → **具体 SQLite query backend**。抽象 query 定义不能单独代表可运行组合。无 persistence 时可读取 live 会话，但 absent/cold id 返回 not-found。Loop 测试额外挂载公开 testkit 的前置服务（LLM、sessions、projections、system prompt、tools、Agents）及生产 AgentLoop。不使用真实 provider、凭据、付费调用、活动 profile 或用户私有历史。

## 实测契约

**已证实**表示对应命名测试实际执行；**不可用**表示该场景中能力缺失或明确拒绝；**未验证**表示没有执行证据。测试专用 grant/budget 探针不等于产品实现。

| 契约与结论 | 状态及实际证据 | 确切来源 |
|---|---|---|
| 版本和公开入口/方法 | **已证实**，SQ1 检查上述固定包元数据和公开方法 | Q/B/S/P/F/L/C |
| 显式 target，不选择最新/当前/关联会话 | **已证实**，SQ4 测试专用准入在任何 query 前拒绝 undefined/空值/空白/带首尾空格目标；所有公开调用使用精确 id。尚无产品 review tool | Q；后续策略探针 |
| 调用者身份与项目/会话归属 | **已证实**，SQ3 可信服务能读取同 cwd 的 peer、child 及异 cwd 会话。`cwd` 过滤、`parentSession` 是元数据，**不是授权**；query 不接收调用 Agent 身份 | Q/S |
| 基础 query caller 授权 | **不可用**，Q/B 明确不提供 caller auth，SQ3 实际跨越上述元数据边界 | Q/B |
| 拒绝不泄露内容/存在性 | **仅测试策略组合已证实**，SQ4 拒绝不查询；SQ18 实际运行原生单调工具 guard：存在和不存在的未授权目标均返回同样 `Error: SESSION_ACCESS_DENIED`，拒绝的 body 不执行，显式授权的自身目标执行一次。不能据此宣称产品 review tool 已授权 | L/T；测试专用 guard 策略 |
| 缺 query/persistence/target 与空历史 | **相应能力不可用或历史为空**，SQ2：未挂 backend 时无 `sessionQuery`；无 persistence 的 cold id 和未知 id 返回 `SESSION_QUERY_SESSION_NOT_FOUND`；空 live 返回 `[]`；`never` 下搜索返回 `SESSION_QUERY_SEARCH_DISABLED` | Q/B/P |
| Live 优先与 detached 结果 | **已证实**，SQ5 query 有 live-only 尾部，公开 persisted handle 只有前缀；修改返回 header/event 不影响后续读取 | Q/S/P |
| Persisted-not-loaded 读取 | **已证实**，SQ6 关闭 Context 后对隔离 JSONL store 重建 Context；`readSession`、`observeSession` 返回历史、`source: 'prepared'`、revision 和精确 cursor，不会将 Session 注册/附着为 live，也不会创建 Agent。Cold query 可以构造未发布的 prepared Session；registry 断言只证明未附着，不证明未构造对象 | Q/B/P |
| 可选 persistence 故障 | **负面夹具已证实**，SQ7 公开 persistence service 子类让 list/stat/open 失败，cold 返回 `SESSION_QUERY_PERSISTENCE_FAILED`；已知 live 读取/observation 不调用后端仍成功。真实磁盘 I/O corruption 未验证 | Q/P |
| 原始 logs 与 current surface 同切点 | **已证实**，SQ8 获取 `observeSession(..., {projectionMode: 'none'})` 租约，**延迟首次访问 events 前**追加新事件；对租约 events fold 得到 cursor `0`、一个原始 node/message。独立稍后的 `readSurface` 捕获 seq `1`，两次独立查询不是原子配对 | Q/S/F |
| Calls/results、原始参数、成功/失败/未知工具、reasoning | **已证实**，SQ11 真实 scripted 生产 loop 记录 3 个 call 及对应 result、成功内容、`FIXTURE_FAILURE`、`UNKNOWN_TOOL`、原始参数 JSON、reasoning 和最终文本；显式 flush 后公开 persistence 与 query 一致。Reasoning 在原始消息中，但不进入文本扫描结果 | Q/S/P/L/T |
| 失败 assistant attempt | **已证实**，SQ12 scripted stream 先给部分文本，再以 `INVALID_CREDENTIAL` 失败；`assistant/attempt.stream` 保存前缀，`turn/end` 为 error；不会伪造 assistant surface message。只发生一次 adapter 调用，不重试 | Q/S/L |
| 未知事件词汇 | **已证实**，SQ13 未知 `ignorable: true` 事件在重开后的 cold raw read 保留，但不产生 surface node 或文本扫描匹配。规范 unknown required 事件（不带 ignorable）可通过可信 append，重开后的公开 storage read 以 `SessionFormatUnsupportedError` 拒绝，query 映射为 `SESSION_QUERY_PERSISTENCE_FAILED`；不能声称 append 即拒绝 | Q/S/P |
| Compaction 与 shadowed 历史 | **记录语义已证实**，SQ10 公开 bracket/summary/checkpoint 替换两个 node；原始内容仍在 raw，记录区分 shadowed/current/log-only，current surface 为 checkpoint + 最近尾部。实际自动/手动 compaction backend 执行**未验证** | Q/S/C |
| 片段截断与消息省略 | **原生行为已证实**，SQ14 完整读取 205 条消息和 >20,000-byte Unicode 片段，不应用上游 review 限制。真实搜索只返回 ≤32-code-point snippet、单条 page 和 `nextCursor`，**不是完整证据**。SQ15 **测试专用** budget probe 分别验证仅 clipping、仅 omission、两者同时发生、byte 边界、保留 id 和输入不变；不交付产品 normalizer | Q/B/L；budget 探针 |
| 不可变来源冲突 | **已证实**，SQ16 `listSessions` 对 live/durable cwd header 冲突返回 `SESSION_QUERY_SOURCE_CONFLICT`，精确直接读取仍优先 live。这不是授权拒绝 | Q/S/P |
| Inherited 与 owned 证据 | **已证实**，SQ17 fork 的精确继承切点为 `1`，seed marker 与后续消息由 child 拥有；persisted-not-loaded observation 保留切点和 parent id。父子关系不授予读取权限 | Q/S/P |
| 所有 profile、历史迁移、任意插件 projection、二进制/附件脱敏、取消竞态、OS 原子快照、真实磁盘损坏 | **未验证**，不从类型、格式 `4`、正面夹具或完整仓库测试通过外推 | Q/S/P/F |

### 后续 reader 的解释规则

- 优先持有一个 `observeSession` 租约，记录 `header.id`、source、`cursor`、cold revision、`inheritedEventCount`。用公开 current interpreters fold **同一个** event array，再调用 `deriveEventMessage(event, folded.projectedMessages)`，最后释放租约。Raw logs、current node membership、投影后的 message content 是不同视图；`readSurface` 返回 current events，不保证原始 event payload 与每个 projected model message 完全相同。
- Observation 是点时证据，不是订阅、锁或持久审计事务。Cold revision 是来源标识，不是密码学完整性证明。可选 projection registry/cache 是否存在以及额外插件 projection 需要单独验证；本契约明确选择 `projectionMode: 'none'` 和公开同前缀 fold。
- Troubleshoot 必须保留 log-only call、attempt、turn error 和 unknown type 存在性；只看 current surface 会丢失失败证据。Semantic filters/search 刻意省略部分记录（包括 failed attempt 和 reasoning），不能替代 raw read。原始证据与有预算的报告表示应分开保存。
- Cold query **仅在内存中**平衡持久化的 interrupted 尾部。SQ9 保存 open step，assistant 请求两个工具，但只有一个 durable call；query 增补 `TOOL_OUTCOME_UNKNOWN`、`TOOL_NOT_STARTED`、step/end 和 interrupted turn/end，公开 storage 内容/revision 不变。合成 unknown result **不证明**副作用失败，也不授权重试。本次不恢复会话、不修复存储。
- 报告 provenance 应区分 persisted raw prefix 与 synthesized suffix。后续候选实现可以对已授权 cold target 使用公开 persistence `stat` / read-handle count；实测 query API 没有通用 synthetic flag。SQ9 只在受控夹具中证明差别，**不证明**并发 writer 下独立 storage/query 读取的原子连接。无法确定稳定 persisted 切点时，将合成归属标为 unknown，不能宣称失败已持久化。
- 不把 snippet 当完整 part，不把 current surface 当完整 transcript，不把 inherited 当 child-owned，也不以 `omittedMessages: 0` 证明片段未截断。保留独立 `partsTruncated`、`messagesOmitted` 标记、byte/message 限制、retained ids 和 range。选择与预算策略是后续工作；SQ15 小实验不证明已安装 normalizer 或 hard total-response cap。

## 固定上游语义映射与署名

仅作语义来源：**codeasier/open-codeasier**，修订 **`20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`**，Copyright (c) **2026 codeasier**，[MIT 许可证](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/LICENSE)。报告保留修订、署名与许可证来源；不复制 OpenCode SDK、transport、轮询、权限兼容层或上游实现代码。本地原创测试适用[本仓库 MIT 许可证](../LICENSE)。

| 实际检查的固定上游资源 | 可迁移语义 / DSH 处理 |
|---|---|
| [tool.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/tool.ts) | 精确 session id、summary/troubleshoot、可选 focus ≤2,000 characters、显式主会话 review 意图。DSH caller/execution 授权必须原生独立实现，不复制 OpenCode context/primary check |
| [fetch.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/fetch.ts) | 非空会话证据及区分 absence/denial/failure；用公开 query lease 替代 SDK get/messages；directory 参数不是权限证明；显式单目标不需要 children listing |
| [normalize.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/normalize.ts)、[schema.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/schema.ts) | Message id/time、tool state/input/output/error、unknown marker、预算/range/count。默认 200 条消息 / 200,000 response bytes / 20,000 part bytes；summary 交替保留首尾，troubleshoot 优先最近消息。这**不是 Q 默认值**。上游顶层 `truncated` 只标消息省略，仅片段截断仍可为 false，不复制这项歧义 |
| [skills/session-review/SKILL.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/skills/session-review/SKILL.md) | 区分事实/推断，披露 session/focus/range/loss，summary 成熟度 L1–L4，troubleshoot P0 证据不可用 / P1 主流程阻塞 / P2 进展退化 / P3 非阻塞；不推断其他 target、不搜索内部 store |

### 最小 summary/troubleshoot 字段映射

这是后续候选契约，**不是已导出 schema 或已实现报告工具**。

| 所需字段 | 固定 DSH 候选与证据 | 限制与后续要求 |
|---|---|---|
| `sessionID`、`parentID`、项目/来源身份 | observation `header.id`、`parentSession`、可选 `cwd`、`source`、继承切点；SQ3/SQ6/SQ17 | cwd/parent 非授权；缺失元数据保持 unknown；primary intent/caller grant 在 Q 外实施 |
| `mode`、`focus` | 用户显式输入；上游 tool 语义 | 不从历史推断；拒绝空/隐式目标；确定并验证 focus 上限 |
| title | Q `readTitleSnapshot` / 同切点 title fold 候选 | **本套测试未验证**；SessionHeader 没有 title；独立 title read 可能切点不同；最小范围先省略 title，不编造 |
| message ids、role、time、range | `user/message.data`、`assistant/message.data.message`、`tool/result.data.message`；event `seq/time`；SQ8/SQ11 | DSH event time 不一定等于 SDK message-created time；包含 user source；不静默丢弃 system/developer 证据；同切点投影生成消息 |
| goals、outcomes、stages/decisions、maturity | 明确保留的 user/assistant 文本与有来源的工具结果 | 是带 seq/message 引文的分析结论，不是服务字段；不推断省略/未记录历史，不因工具成功即认定流程成熟 |
| summary capability candidates、automation boundaries、standardization guidance | 保留的流程阶段、重复动作和显式决策，回引对应 message/call | 是分析建议，不是原生字段或可重复性证明；L1–L4 判断须区别于已观察结果 |
| troubleshoot causes、tool-call quality、minimum recovery recommendation | 原始请求参数、配对结果、attempt 和 terminal reason；SQ9/SQ11/SQ12 | 将假设优先级与事实分开；synthetic unknown outcome 禁止盲目重放副作用；仅推荐下一步，不执行恢复 |
| calls/input/output/error | `tool/call` name/raw arguments/callId；`tool/result.message.toolCallId/content/isError`；可选 `error`/`meta`；SQ11 | 按 call id 配对，保留原始 JSON 但不假设解析成功；工具私有 metadata 必须有界脱敏；请求工具不等于动作完成 |
| stopped stage、failed/last useful action | turn/step 边界、`turn/end.reason`、`assistant/attempt.stream`；SQ9/SQ12 | Failed attempt 不是 assistant surface message；缺失 usage/error 保持 unknown；保留 interrupted 和 synthetic 来源 |
| raw/current/shadowed/unknown | Q event array + S/F fold/records + C checkpoint；SQ10/SQ13 | Raw 用于证据；标记摘要/replacement、未知事件存在性和 unsupported 记录；不将压缩摘要扁平化为原始事实 |
| total/included/omitted messages、retained ids、首尾 range、fragment loss | 先定义 evidence-message 域，再计数与选择；独立 part/message flags；SQ14/SQ15 实验 | Events ≠ messages；确定 total byte cap 及确定性 summary/troubleshoot 选择；metadata-too-large 必须拒绝，不能静默省略安全元数据 |
| unavailable diagnostic 与 uncertainty | service absent、not-found、persistence failed、search disabled/conflict；SQ2/SQ7/SQ13/SQ16 | 未授权 caller **查询前**收到 neutral denial；不向模型发送 raw persistence error、路径、provider envelope 或 secrets；可信排障细节单独处理 |

## 可拟定的后续 issue

**范围：**一个默认禁用的 DSH-native 只读 review-input tool，只接受一个精确 target 和用户显式 review 意图，向指令资源提供有预算的 summary/troubleshoot 证据。先支持固定、明确组合的 Q/B 和可选当前格式 JSONL P；不自动发现会话、不跨会话聚合、不生成导出、不归档、不删除、不修复/恢复，不编排付费 review；不新增 TUI 准入承诺。

**依赖：**声明直接固定公开包；设计可信 Host 策略，在每次 lookup/content read 前绑定真实 caller identity + 精确 target + 显式 intent；独立定义部署 scope/grant，不用 cwd/lineage 代替授权；保留原生 effective tool policy 和单调 guard，不允许 reviewer 旁路。确定同切点 projected/raw evidence schema、secret/attachment 策略、synthetic 来源不确定性，以及确定性的 message/part/total-byte 预算。其他 profile/history format/projection plugin 单独验收，不静默支持。

**验收：**产品 tool 测试必须重新覆盖显式 target 校验，owner/granted 允许及同 cwd/父子/异项目拒绝，存在性中立且不访问 backend 的拒绝，缺失/空/不可用诊断，live 成功及重开 cold 成功且不会将 cold Session 注册/附着为 live，也不会创建 Agent，同切点 raw/current 并发 append，call/result/unknown/failure attempt、compaction/inherited 边界、synthetic unknown outcome，独立 clipping/omission、UTF-8 与 hard total-byte cap，释放/取消、凭据脱敏及 cross-review 原限制不变。使用离线 scripted adapter 和双语 docs 检查，不跑付费模型、不安装 profile。SQ4/SQ15/SQ18 只是策略/预算可行性探针，不满足后续产品 tool 验收。

**显式导出输入候选：**若部署不能挂载已授权 public query，未来工具可以考虑用户提供、明确选定的数据，但**必须先**单独确定 schema/source/cut/integrity/loss/size/secret 契约。本次不承诺已确认 exporter/format；测试没有生成或消费导出。其授权、时效、来源和完整性均**未验证**。不自动选择 exporter，也不回退私有数据库。

## 复现与验证记录

使用现有固定依赖；这些命令不包含安装操作。

```sh
node --test --test-concurrency=2 test/session-query-contracts.test.mjs
node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts
pnpm run test:contracts
pnpm run test:docs
pnpm run plugins:check
pnpm run test:plugins
pnpm run build
pnpm run test:types
```

- 聚焦契约：**18 passed、0 failed、0 skipped**。真实 snippet/search 测试会出现预期的 Node SQLite experimental warning，不隐藏警告。
- `node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts`：**144 tests、142 passed、0 failed、2 skipped**（需单独开启的 package/profile gate），exit `0`。
- `pnpm run test:contracts`：**3/3 passed**；`pnpm run test:docs`：**4/4 passed**，包括本调查中英文配对；`pnpm run test:plugins`：**13/13 passed**；均 exit `0`。
- `pnpm run plugins:check`：**1 个现有插件校验通过**，exit `0`；`pnpm run build`、`pnpm run test:types`：**通过**，exit `0`。未添加插件或包元数据。
- 开发探针曾失败：DSH 根入口未导出；显式空 Session seed 增加 lifecycle marker；tool renderer 接受 `(args, value)`；搜索页字段为 `items`；`ignorable: false` 不是规范 required-event envelope；seeded persistence create 必须显式传 inherited count。已根据公开契约修正夹具并重跑，没有为通过测试而 patch 上游服务。
- **未运行：**package acceptance（会安装依赖）、`test:dsh-profile`、`test:tui-profile`、其他 DSH/Cordis 版本、active-profile 检查、私有历史及付费模型。这些不属于本调查，不新增通过或完整 TUI 声明。
