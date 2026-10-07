# 公共契约与验收

[English](contracts.md) | [简体中文](contracts.zh-CN.md) | [文档索引](README.zh-CN.md)

这是为 issue #1 开发的尚未发布的软件包。单元测试通过，并不意味着整个默认配置、每一种模型后端或已发布的安装方式都受支持。

## 已验证的契约目标

原生软件包固定为 **DSH 0.2.0-rc.2** 和 Cordis 4.0.4。原始交付选择了 0.2.0-rc.2；当时确认它对应 npm 的 `latest` 标签。这里描述的是固定的原始交付范围，不是对当前注册表标签的声明；标签不是兼容性保证。用户当时要求的交付范围，是该固定版本所支持的能力，而不是未来的带清单命令准入能力。测试挂载已发布的原生 AgentLoop、工具注册表、全新 spawn 后端、审批服务和带类型的 JSON 域存储。唯一的 LLM 适配器是使用脚本响应的本地测试夹具：不涉及提供方凭据或付费评审。

可选适配器面向**已发布的 dsh-TUI 0.12.0 公共子路径**。实际的状态/场景挂载及命令拒绝，与成功通过生态准入是不同的事情。原生运行时软件包声明为 Host peer，仓库检查所需副本仅放入开发依赖。一次性配置依赖 DSH 的公共运行时解析，而不额外安装 `agent-loop`；在启动脚本化评审者之前，先执行普通的 `bash pwd` 和文件系统 `read` 调用。适配器自身的活动 fiber 诊断确认：命令注册被拒绝，因为调用方激活没有经过验证的 `dsh-plugin.json` Component 身份；仅有 Cordis Loader 激活并不足够。已安装的公共组合没有受支持的 Component 准入桥接。针对这一固定版本的验收使用 `test:dsh-profile`：在获得批准的原生评审者完成后，执行真正的所属 Agent `cross_review_report`/`cross_review_control` 调用；拒绝过期修订而不改变状态；移除终态运行/快照聚合体；并验证 Host 的平稳释放以及按确切路径清理临时 HOME。它还验证可选 TUI 的如实降级，不提供命令回退。`test:tui-profile` 则单独保留更广泛的完整中介式命令/报告场景要求；仅有原生 Loader 激活不会产生经过验证的 Component 身份。

| 契约 | 回归证据 |
|---|---|
| 全新的原生子代理；在首次调用前绑定确切的子代理身份和证据 | `native-contracts.test.mjs`、`native-driver.test.ts` 的异步绑定屏障 |
| 只读执行边界；限定范围的注册/PTC 不能绕过该边界 | 原生驱动测试、原生单调约束 guard 和原生结构化结果捕获 |
| 冻结评审者/模型/模式/输出上限；不替换路由 | `protocol.test.ts`、`lifecycle-races.test.ts` 中的调用方变更和 Host 路由用例 |
| 固定的本地/范围/PR 证据；完整 diff；补充数据不能覆盖它 | `evidence.test.ts` 中的 Git 测试夹具、模拟的公共 PR 元数据，以及变更/符号链接/路径遍历/秘密/二进制用例 |
| 有界并发、故障隔离、仅使用终态结果的法定数量判断，以及空结果 | `service.test.ts`；工作不由状态轮询驱动 |
| 不同的评审者身份；不投票；独立验证引用和决策 | `judge.test.ts`、`lifecycle-races.test.ts` 中的持久化完成/法定数量验证 |
| 原生开放回合的费用授权；拒绝 never/拒绝/不可用/取消情形 | `service.test.ts`；匹配的无头摘要不会覆盖原生应答方 |
| 启动时执行后的拒绝/替换/关闭不能派发子代理 | 服务和生命周期测试；已暂存的确切执行等待权威最终结果 |
| 超时先停止未完成的原生工作，再等待保留/中止决定 | 服务和生命周期测试；排队中的超时被取消/释放取代时，重新打开的状态、修订和审计记录保持不变；排队中的法定数量失败不能覆盖取消 |
| 真正的取消、父级释放和插件释放达到静止状态 | 原生驱动/服务/生命周期测试断言原生注册表和监听器已清理 |
| 原生持久化结果、哈希/模式验证，以及不自动重放付费工作 | `store.test.ts`、`service.test.ts`、模型裁判恢复生命周期回归 |
| 同一主机跨进程所有权；检查修订的控制操作 | 重新打开域的事务锁、运行时租约、独立子进程写入/恢复及过期控制回归 |
| 安装插件后保留普通 Host 工具执行能力 | `host-dependencies.test.mjs`；不额外安装 loop 包的 `test:dsh-profile`，真正的普通 bash/read 调用 |
| 无 React/TUI 的 Host；可选能力拒绝及其自身释放 | 实际 Host 挂载测试和 `tui.test.ts` 公共接缝/边界测试 |
| 固定原始交付版本 DSH 的评审、原生报告/控制工具、过期修订拒绝、聚合体清理和释放 | `test:dsh-profile` 真实 CLI/配置/PTY 验收关卡；不可用的可选命令必须显示原生工具指引，并保持未注册 |
| 成功通过生态准入的 TUI 命令及报告场景消费 | 单独的 `test:tui-profile` 完整验收关卡在已安装的固定版本上仍未满足；绝不能以原生工具证据或 Loader 的拒绝证据替代它 |
| 原创 `/cross-review` Skill 入口、setup 与评审意图分流、固定作用域路径与确认后的原生配置写入 | `cross-review-setup.test.ts` 真实 Host 注册、保存/取消/释放、不安全路径拒绝与重读验证；`service.test.ts` 文件/Host/单次调用优先级及未放宽的证据排除策略；不声称 Skill 安装、profile 验收或推理成功 |
| 插件描述符、独立导出、带保护条件的旧版覆盖、禁用导入和安全的本地脚手架 | `plugin-repository.test.mjs`、`plugin-scaffold-boundaries.test.mjs`、`plugins:check`；仓库元数据不等于原生/TUI 准入 |
| tarball 内容，以及不依赖 TUI/React 的生产 Host 导入 | 单独启用的 `test:package` 验收关卡，使用隔离的 HOME/存储和公共注册表依赖；不代表发布或向活动配置安装 |

## 接口来源

实现使用公共根导出和已发布声明，而不是私有会话数据库或 OpenCode 传输层：

- `@deepseek-ai/dsh-agent`：`AgentRegistry.create`、创建时的 `setup`、等待完成的 `agent/created`、`agent/disposed`、由调用方拥有的工厂生命周期，以及 `AgentHandle.dispose`。
- `@deepseek-ai/dsh-subagent`：进行能力验证的 `start('spawn', request)`、`toolFilter`、`outputSchema`、规范的请求取消、终态 `result`，以及由所有者负责并等待静止的释放。一次性的 `interrupt()` 不等于取消。
- `@deepseek-ai/dsh-subagent-in-process-driver`：导出的 `STRUCTURED_OUTPUT_TOOL`。刻意不导入未导出的 `attachStructuredRuntime` 辅助函数。
- `@deepseek-ai/dsh-tools`：`defineTool`、`restrict`、`presentAs('native')`、单调约束 `guard`，以及权威的 `tools/result`。用于编写值模式的 DSL 在每个属性上使用 `required:true`，与原始 outputSchema JSON 不同。
- `@deepseek-ai/dsh-llm`：公共模型目录/解析和最终流式边界。确切的子会话身份控制对冻结路由/上限的访问；管理控制器不能调用模型。不相关的 Host 请求不受影响。
- `@deepseek-ai/dsh-user-approval`：公共 `request`、会话覆盖和已配置策略。`allowed-once` 是唯一的授权；原生审批要求存在开放回合。后端不会伪造回合，也不会插入优先应答方。
- `@deepseek-ai/dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`：专用的公共原生后端和域设施将操作路由到已知私有根目录。聚合体在写入前验证，并在重新打开时再次验证。JSON 发布协议记录了临时文件 fsync、rename 和 POSIX 目录 fsync。
- `@deepseek-ai/dsh-atomic-write`：根目录 `withFileLock` **从重新打开已提交的域之前，持有到本次事务的域/后端关闭**。原生缓存后端不会跨越这个锁存活。独立的 UUID 运行时锁一直持有到服务排空/关闭；恢复在持有根目录事务锁时探测前任租约，跳过仍存活或无法证实退出的所有者。不会把实用函数 `writeFileAtomic` 与原生 JSON fsync 协议混为一谈。作用域初始化配置使用同一个公共锁，仅执行一次原子替换（`writeFileAtomic`，权限 `0600`）；该实用函数明确不负责崩溃持久性（fsync），因此初始化只声称原子替换，不声称崩溃持久性。
- 可选 TUI：仅从 `/plugin-host`、`/extensions`、`/scenes` 导入类型；采用非强制能力探测，并以实际注册是否获准为准。`registerCommand` 使用清单中声明的贡献项。Cordis 文档将 `Fiber.ctx` 定义为实际的插件激活 Context；匹配的非零 fiber UID 证明激活所有权，而不是生态准入。从另一个插件的异步激活中借用的 grants 探测本身也可能被拒绝，因此不能替代适配器自身激活的注册证据。`Context.is` 能跨不同副本识别 Cordis 上下文；仅有 `instanceof` 不匹配不能解释拒绝原因。适配器从自身激活发出冻结的 `cross-review/tui-capabilities` 诊断；观察者故障不能改变注册或释放，该诊断也不是授权凭据。诊断不得使用 `extend()` 制造授权。不使用 `getHostAdmission`、`bindComponentIdentity`、根 React 导入、原始终端钩子或私有测试辅助函数。

公共软件包文档随固定的软件包一起分发，来源为 [DSH 仓库](https://github.com/deepseek-ai/deepseek-harness) 和 [dsh-TUI](https://www.npmjs.com/package/@deepseek-harness-tui/dsh-tui)。锁文件记录确切解析到的产物。

## 状态与所有权

运行从 `running` 转为 `awaiting_judge`、`awaiting_timeout`、`completed`、`failed`、`cancelled` 或 `interrupted`。父级裁决和超时决定是持久化状态，而不是进程内作业状态。法定数量为 `floor(configured reviewers / 2) + 1`，计入的是不同评审者身份的、通过模式验证的终态结果。完成记录中不能留下仍待独立裁决的候选问题。

每项控制操作都会认证确切的、仍存活的所属 Agent，以及稳定的会话/项目/运行时所有权。改变状态的控制操作会在串行化持久化转换内部再次检查预期修订。清理先取得一个修订的控制权，再删除同时包含报告和快照的单一聚合体；绝不会计算递归删除工作区的操作。

管理控制器是调用方作用域中由原生工厂拥有的子代理。它们自身的步骤前关卡拒绝提示，最终模型关卡禁止派发。每个真正的评审者都是全新的原生 spawn 子代理；在发布并放行工作之前，各自的范围已独立限定到不可变的内存证据。

不支持跨主机或跨 PID 命名空间的共享状态部署。原生写锁和运行时租约提供协作式本地所有权，不是 fencing、分布式租约或远程取消传输层。只读状态/报告观察已验证的进程本地快照；每次写入和恢复都在根目录锁下重新加载已提交的原生状态，并再次校验所有权/修订。不会附着或恢复仍存活的其他实例记录。域布局及模式/策略版本保持不变。

## 恢复与保留

持久化域是权威来源。恢复前会验证快照内容、目标/来源、模式/策略版本、确切的原生绑定和终态结果契约。已确认的完成结果会被复用；未知尝试会变为 interrupted。未知的模型裁决会使**运行**变为 interrupted，而不是假装有人类决策待处理。待处理的父级裁决和超时决定保持明确可见。

恢复绝不会重新加载付费子代理、用父级替换配置的裁判，或重放未知调用。如果仍存在未解决的模型裁决，必须启动一个重新获得授权的运行。状态/报告 API 是只读的。完成和中断的产物会被保留；仅限所有者的终态清理将报告和快照一起删除。不会自动清理并悄悄删除待处理决策所需的证据。

## 有意保留的限制

### 安装失败诊断

- 普通工具报 `Cannot read properties of undefined (reading 'prepare')`：profile 内的 `dsh-tools` 和安装目录中的 `dsh-agent-loop` 可能持有不同的模块本地调度器 Symbol。将原生 Host 模块声明为普通依赖，即使版本相同也会导致这个分裂。必须声明为 peer，并使用 profile 的公共 `autoInstallPeers: false` 布局；仅禁用插件不会移除已安装的遮蔽副本。更新已安装 profile 需要单独授权的软件包操作，并重开 Host 进程。
- `cross-review-owner.lock` 获取超时：旧实现会在插件整个生命周期内持有共享根目录锁。当前事务锁/运行时租约分离后，空闲或活动的多个 Host 可以共存，且不会恢复彼此仍在进行的工作。尚未退出的旧 Host 仍会持有原先的生命周期锁，必须先排空/退出，新实现才能使用该根目录。不要删除存活写入者的锁或其证据存储。

### 运行限制

- 证据仅支持 UTF-8 文本，单个文件上限为 8 MiB，文件聚合体/diff 上限为 64 MiB。拒绝会明确报告；不会把截断的评审作为完整结果返回。
- 拒绝不安全的符号链接、子模块、已变更的排除路径/运行时路径/凭据路径，以及包含命令的 Git 过滤器。类似凭据内容的扫描采取失败即拒绝策略，既可能拒绝真实秘密，也可能拒绝测试夹具或示例。
- 已实现公共 GitHub/GitCode PR 元数据和确切提交对象的获取。元数据结构测试使用本地已有对象；不能从模拟元数据推断真实网络 Git-fetch 验收已通过。需要身份认证的/私有元数据需要单独的 Host 准备适配器，目前会明确失败。
- 本地两遍捕获会检测变更，但不是能抵御恶意 ABA 变化的文件系统事务。评审者自身在绑定后绝不读取可变文件系统。
- 原生取消是协作式的，并会等待静止，不是对任意同进程代码的强制终止。
- 输出上限是**每个请求**的上限，不是货币限额或整个运行的支出限额。插件不会重试失败的编排尝试；有效的原生 Host/提供方请求策略仍然适用。
- TUI 软件包将 working-activity 与较旧的 DSH/React peer 声明及运行时 `workspace:*` 清单一起打包。已验证全新和冻结锁文件的 pnpm 安装；npm 全新安装会拒绝这些清单。应使用固定的 pnpm 包管理器和锁文件。一次性配置会使用 CLI 的默认基础 bundle 和官方提升依赖/不自动安装 peer 的工作区布局来准备公共配置清单，然后在官方 CLI 安装软件包之前固定并验证 pnpm `11.21.0`；空的 Corepack HOME 不得选择随时间变化的 latest 包管理器版本。这种普通配置不会提供或绕过带清单的 Component 准入。依赖构建脚本以及 `pnpm run` 期间的隐式安装均被显式禁用；未应用任何第三方软件包补丁。不会用“所有随附配置功能均兼容”的声明掩盖这些事实。
