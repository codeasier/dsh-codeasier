# DSH 插件集合架构

[English](architecture.md) | [简体中文](architecture.zh-CN.md) | [文档索引](README.zh-CN.md)

`dsh-codeasier` 是一个尚未发布的 npm 分发包，包含可独立组合的 DSH 原生插件和可移植的指令资产。它不是自定义 Agent 引擎，也不是 OpenCode 兼容运行时。

```text
package.json dsh.bundle.patch -> 根目录 cordis.patch.yml（扁平 Host 条目）
                                      |
                      原生 DSH / Cordis Loader
                                      |
               dsh-codeasier/plugins/<id> (Host)
                                      |
                  插件自己的类型化服务
                          /           \
                   原生工具         可选 <id>/tui

plugins/<id>/plugin.json -> 仅用于本地列表/检查/脚手架工具
plugins/<id>/SKILL.md    -> 指令资产；不触发原生激活
```

## 所有权与目录布局

- `src/plugins/<id>/index.ts`：规范的原生 Host 模块；导出 `name`、`inject`、`Config`、`apply`。内部服务和类型保留在该功能目录中。
- `src/plugins/<id>/tui.ts`：仅用于可选、对版本敏感的适配器。Host 在运行时绝不导入它、React 或 TUI。
- `plugins/<id>/`：仓库描述文件、README、独立原生补丁或 Skill 资产。不存在由描述文件驱动的运行时自动加载器。
- `scripts/`：仅供仓库使用的发现、schema/补丁/导出校验和安全脚手架工具。这些脚本不是运行时包入口。
- `test/`：插件契约/回归测试，以及集合/包/profile 验收门槛。在这次仅涉及源码的迁移中，现有审查测试保留原名称。
- `src/{host,tui,protocol,...}.ts`：兼容转发模块。它们保留导出身份，而不是重复实现。新功能应放在 `src/plugins` 下，绝不能放进这些兼容转发层。
- 只有当多个插件确实使用某段代码时，才应抽取共享代码；cross-review 的证据/监督器/存储内部实现不是通用框架。

根聚合仍然仅包含 Host，并保留 `id: cross-review` / `name: dsh-codeasier`。未来的原生插件各自使用独立的 Loader 条目，初始状态为禁用。用户通过原生公开 Loader 契约配置、禁用和释放每个条目。不引入自定义嵌套 `plugins` 配置、运行时注册表、monkey-patch 或模型生成的工作流。

## 三种不同的清单

1. `package.json` 的**原生** `dsh.bundle.patch` 选择根补丁。公开 DSH 接口接受相对于包根目录的路径字符串或有序路径数组。我们选择一个聚合补丁，而不是同时选择它和存在重叠的独立补丁。
2. `plugins/<id>/plugin.json` 是**仓库自有元数据**，schema 版本为 1。它仅驱动本地工具。DSH 不会自动发现这些描述文件、命名配置、子路径 bundle 或 Skill 资源。
3. 包根目录的 `dsh-plugin.json` 是 cross-review 适配器现有的**可选 TUI Component 清单**。原生 Loader 激活或仓库元数据并不能提供经过验证的 TUI Component 身份。当前的准入缺口仍明确保留。

Node 导出暴露模块/资源；它们不会让 `dsh-codeasier/plugins/<id>` 成为可独立安装的包，也不会让它成为 `dsh.profile.bundles` 中的有效包名。Profile bundle 指向已安装包的根目录。资源导出解析为文件；原生 CLI 的 `--patch` 接受文件系统路径，不会自动按 npm 标识符查找。

## 组合边界

- 在包聚合补丁和插件的独立插入补丁之间二选一。不要同时挂载旧别名与规范别名，也不要组合重复插入。原生补丁组合不会拒绝重复 ID，Cordis 也不会对回调别名去重。
- `id` 保持稳定；覆盖层中提供的 `name` 是精确匹配的保护条件。根条目保留原名称，以使现有带保护条件的覆盖层继续有效。规范的独立组合使用新名称。
- 补丁的 `config` 会替换整个先前配置，而不是深度合并。插件专属的、经过校验的配置分层（例如审查调用覆盖配置）是另一回事。
- `disabled: true` 阻止原生模块导入/激活。不会仅为列出目录或禁用某项功能而加载可选依赖。
- 仅含 Skill 的资产不会插入 Loader 条目或注册工具。提示词无法强制执行工具权限、取消、费用授权或崩溃恢复。需要这些保证时，它们应由原生 Host 实现。

## Cross-review 不变量

这次重构仅调整源码归属。工具/服务 ID、不可变证据、执行前的原生子代理绑定、执行级防护、生命周期/定时器调度、费用策略、所有者/修订版本控制、审计和持久化恢复均保持不变。存储路径及 schema/策略版本不会升级；不发生持久化迁移。完整后端行为得到保留，不会被 Skill 包装层替代。

当前原生交付的验收门槛是 `test:dsh-profile`。更严格的、要求中介命令/report-scene 成功执行的 `test:tui-profile` 仍是独立门槛，目前尚未满足。参见[契约](contracts.zh-CN.md)、[TUI 准入缺口](tui-admission-gap.zh-CN.md)和 [cross-review](../plugins/cross-review/README.zh-CN.md)。
