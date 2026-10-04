# 添加和迁移插件

[English](plugin-development.md) | [简体中文](plugin-development.zh-CN.md) | [文档索引](README.zh-CN.md)

## 本地开发命令

```sh
pnpm plugins:list
pnpm plugins:check
pnpm plugin:new session-review
pnpm plugin:new handoff-notes --kind skill
pnpm run test:docs
pnpm run check
```

这些是仓库工具命令，不是安装命令。它们绝不会修改当前启用的 DSH profile、调用模型、发布，或启用生成的插件。使用唯一的小写 kebab-case ID。已有文件、悬空符号链接和带符号链接的父目录都会被拒绝；没有强制覆盖选项。创建过程不是覆盖全部文件的事务性文件系统操作：如果 I/O 失败留下了不完整的脚手架，请先检查再重试；已有输出绝不会被自动覆盖。

### 原生插件脚手架

`plugin:new <id>` 创建：

```text
src/plugins/<id>/index.ts         # 类型化 Cordis 入口；实现前一律拒绝执行
plugins/<id>/plugin.json          # schemaVersion=1, kind=native, status=scaffold
plugins/<id>/cordis.patch.yml     # 独立条目，disabled:true
plugins/<id>/README.md            # 迁移/署名说明
test/<id>.test.ts                # 稳定身份检查 + TODO 行为契约
```

通用包导出和 TypeScript 的 include 已覆盖新功能目录。无需修改 cross-review 或根 API。脚手架不加入聚合 bundle。其身份测试**不能**证明行为已完成迁移；尚未解决的行为测试会明确标记为 TODO。

完成原生插件的步骤：

1. 使用已确认的公开 DSH 服务实现 Host。导出有效的 Cordis 命名空间（`name`、`inject`、`Config`、`apply`），而不是默认导出的目录对象。声明必需服务；校验实际运行时输入，而不只是编辑器 schema。
2. 让工具/命令/TUI 共用一个类型化服务。将取消/清理绑定到原生插件生命周期；注册和资源由原生 `ctx.effect` 或返回的释放函数负责。
3. 添加适合该功能的离线授权、副作用、隔离、失败、恢复和释放契约。除非该插件确实需要，否则不要复制 cross-review 内部实现。
4. 在 README 中记录原始源码 URL/修订版本、保留的许可证/声明、支持的公开 API 组以及已知缺口。不要将脚手架标记为受支持或已安装。
5. 保持 `defaultEnabled: false`（原生描述文件的默认值）；cross-review 显式设置的 `true` 仅用于保留现有 bundle 行为。将描述文件改为 `status: implemented`，完成所有 TODO 契约，并将其扁平 Host 条目加入根 `cordis.patch.yml`，**初始必须设置 `disabled: true`**。新可选功能的独立补丁也应保持默认禁用。只有在提供配置和前置条件之后，才在用户覆盖层中显式启用。`implemented` 描述代码实现状态，不代表发布/profile 验收通过。
6. 运行与该功能相关的检查及打包/临时 profile 验收门槛。将可选 TUI 验收与后端验收分开。

聚合新增条目示例：

```yaml
- insert:
    - id: cross-review
      name: dsh-codeasier              # 保留这个用于旧版带保护条件覆盖层的名称
    - id: session-review
      name: dsh-codeasier/plugins/session-review
      disabled: true
```

用户覆盖层可以用 `disabled: false` 和完整的 `config` 覆盖 `session-review`。不要在此聚合之上再组合其独立插入补丁。原生 `config` 覆盖会整体替换；请在实际生效的覆盖层中提供完整的 Host 配置。`plugins:check` 会拒绝重复的聚合 ID、错误的入口/资源、不安全的描述文件和已启用的脚手架。它检查仓库随附的补丁，而不是任意用户覆盖层。

### Skill 资产脚手架

`plugin:new <id> --kind skill` 仅创建 `plugins/<id>/{plugin.json,README.md,SKILL.md}`。它不注册任何工具或 Cordis 条目。原生 DSH Skill 的发现/安装是另一项需要显式执行的操作；无论是描述文件，还是将此包加入 `profile.bundles`，都不会把 Skill 文件安装到用户的 Skill 目录中。

重写可移植的任务指令、资源引用和 DSH 工具/配置名称；校验 frontmatter 和前置条件。不要在声称已适配 DSH 的指令中留下 `opencode models`、`.opencode/...`、OpenCode SDK 调用或不存在的 DSH 工具。保留署名。只有在手动验证行为之后，才能设置 `status: implemented`。如果 Skill 需要可强制执行的副作用、模型编排、恢复或有界执行，请改为创建原生脚手架（或使用不同的 ID），并移植相应行为；仅靠指令无法实现这些保证。相关指令资产可以与原生插件资源并存，但不得削弱原生授权。

## OpenCode -> DSH 迁移检查清单

| 源端关注点 | DSH 原生对应实现 |
|---|---|
| OpenCode `PluginModule`/SDK 传输 | 注入公开原生服务的 Cordis `apply` |
| 工具 schema 和处理函数 | `defineTool`、原生 schema DSL、调用者所有权和权威结果 |
| 斜杠命令 | 公开命令服务；共用处理函数/服务，而不是重复逻辑 |
| 隔离的审查者会话 | 原生全新子代理；真正限定范围的证据/执行边界，而不是对 cwd/提示词的宣称 |
| 后台调度/轮询 | 原生事件/定时器加持久化状态；观察操作绝不触发调度 |
| 权限兼容钩子 | 实际生效的原生策略/审批；拒绝和 `never` 均采用失败时拒绝的策略 |
| 运行时持久化 | 类型化原生存储，具有显式 schema、所有权和恢复契约 |
| OpenCode UI 钩子 | 基于已确认公开 TUI 契约的独立可选适配器 |
| Skills/commands/agents Markdown | 使用 DSH 专属工具名并明确前置条件的可移植文本资产 |
| 现有安装器 | 不复制对当前启用 profile 的修改或对私有状态的访问；只有在单独验证公开资产契约之后才能添加 |

迁移应逐项功能进行，而不是构建 OpenCode API 模拟层。对从 [open-codeasier](https://github.com/codeasier/open-codeasier) 改编的任何可移植代码/文本，保留许可证声明。其功能目录，以及运行时与工作流资产的分离，是有价值的先例；它当前的单个插件注册了多个工具，并非独立的模块开关。这里的插件启用由原生 DSH Loader 独立组合。

## 可选 TUI

如有需要，添加 `src/plugins/<id>/tui.ts` 和 `plugins/<id>/tui.patch.yml`；按约定声明描述文件中的 `tui: {entry, patch}`。使用条目 ID `<id>-optional-tui`，依赖插件的类型化服务，并将其排除在聚合仅含 Host 的默认配置之外。导入必须仅涉及类型，或是严格可选的公开能力探测；Host 导入绝不加载 TUI/React。如实记录缺失能力。仓库描述文件或导出的补丁**不会**凭空提供 TUI Component 准入资格。现有包根目录 Component 清单继续只覆盖 cross-review；其他适配器需要自己经过确认的生态准入设计，而不是覆盖该身份。

## 支持范围

一个包含独立插件入口的包在当前已足够。只有当发布/依赖隔离确实有必要时，才拆分包。不要创建空的共享框架或通用的模型驱动工作流引擎。让新功能保持显式选择启用，保留稳定 ID 和带版本的持久化契约；绝不要把运行真实付费审查、发布或安装到当前启用的 profile 作为迁移或测试的副作用。
