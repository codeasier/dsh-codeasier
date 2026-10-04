# 尚未解决的原生 TUI Component 准入问题

[English](tui-admission-gap.md) | [简体中文](tui-admission-gap.zh-CN.md) | [文档索引](README.zh-CN.md)

## 范围

验证环境为 Node 22.22.3、公共 DSH 0.2.0-rc.2、Cordis 4.0.4、Cordis Loader 1.0.5 和 dsh-TUI 0.12.0。这是所检查的已安装组合的限制，不是对未来版本或未发布集成的声明。issue #1 的完整中介式 TUI 验收仍未满足。这个可选功能的限制并不阻碍用户缩小后的交付范围：通过原生评审/报告/控制工具和明确的 TUI 降级，支持原始交付所选 DSH 0.2.0-rc.2 提供的能力。原始交付选择了 0.2.0-rc.2，当时它对应 npm 的 `latest` 标签；此处描述的是固定的原始交付范围，不是对当前注册表的声明，标签也不是兼容性保证。

## 实际配置证据

需要显式启用的 `test:tui-profile` 验收关卡，会把本地打包的后端和可选适配器安装到新建的临时 HOME/配置中，禁用真实提供方和无关配置功能，并通过 PTY 驱动实际 TUI。它仅使用脚本响应的 `fixture-only` 提供方。在真正的父级回合中，明确的原生审批启动两个全新且已绑定证据的评审者；两者都返回终态结构化空问题发现，其原生子代理/控制器随后被释放。

适配器处于 ACTIVE 状态（state 2），具有真实的非根激活 UID。对外公布的 Host Descriptor 包含 `commands.dsh/v1alpha1#Command`；富格式进度和报告场景注册可用。然而，适配器的**自身激活**发布了以下信息：

```text
command: false
Mediated review command registration was refused:
the calling activation has no verified dsh-plugin.json Component identity
```

所属 Agent 的原生命令注册表中没有 `review` 命令；当前 TUI `/review` 仍被拒绝，并降级为原生工具使用指引。测试夹具在发送报告文本之前失败，因此不会把未知命令转发给模型。即使出现这一失败，PTY 终止和按确切路径清理临时 HOME 仍会完成。原生评审成功，不等于中介式 TUI 命令/报告/控制验收成功。

证据来自适配器自身发出的冻结 `cross-review/tui-capabilities` 事件，而不是借用其他插件 Context 的测试夹具。跨插件异步探测可能独立于准入而被拒绝。Cordis `Context.is` 也支持多个副本，因此 `instanceof` 不匹配不足以证明原因。

## 公共 API 边界

已发布声明和导出提供以下证据（下列路径位于固定的软件包内部）：

- TUI `package.json`、`exports`：没有公共准入、Kernel 或 Loader 桥接子路径；也没有暴露适配器内部实现的通配符。
- TUI `lib/types/plugin-host.d.ts:1–14`：提供公共中介式服务、类型和常量，但没有准入或身份绑定导出。
- TUI `lib/types/dsh-adapter/plugin-host.d.ts:65–82`：公共 `TuiPluginHost` 支持 grants、描述符、中介式命令注册和诊断。它明确指出，软件包导出刻意不包含仅限 Loader 的准入能力。
- 同一声明的 `:164–168` 指出，内部准入能力仅限 Loader，使用公共服务代理的插件会收到确定性的拒绝。
- Cordis Loader 的公共 `EntryOptions` 提供 `id`、`name`、`config`、`group`、`disabled` 和 `inject`；其配置提供 `baseUrl`。激活过程导入配置的模块并运行插件，没有感知清单的身份准入钩子。
- 公共 DSH `runProfile`/`boot` 组合这些 Loader 条目。其已发布选项不能选择/准入带清单的 Host facet。原生软件包清单描述的是 bundle 补丁/配置 bundle，而不是 TUI Component 身份准入。
- `@dsh-std/manifest` 解析、验证并投影静态清单；这些操作不会把身份绑定到正在运行的 Cordis 激活。

对这些公共接口的有限范围检查，没有发现能够提供所需的、由 Host 负责的准入步骤的受支持原生配置方案。为核实来源而阅读已发布实现后，确认插件侧自我准入被有意拒绝；它不是可用的变通方法。

## 所需的上游集成

需要一个受支持的、由 Host 拥有且感知清单的 Loader/组合桥接：读取已安装软件包的 `dsh-plugin.json`，验证/协商其 Host facet，并在可选适配器注册命令**之前**，把经过验证的身份绑定到实际激活。桥接必须保留原生生命周期所有权和有效权限检查。该集成提供后，应针对新构建的 tarball 重新运行正向配置验收关卡，并要求报告渲染、过期修订拒绝、终态清理和完整释放。

这里没有添加任何私有准入访问器、身份绑定辅助函数、Host monkey-patch、自行创建的授权 Context，或无法归属的直接命令回退。在该公共集成存在之前，正向配置验收关卡仍然失败；验证拒绝行为的边界测试不能替代它。未执行发布、向用户活动配置安装或付费模型评审。
