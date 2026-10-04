# 工作流 Skill 验证

[English](workflow-skills-verification.md) | [简体中文](workflow-skills-verification.zh-CN.md) | [文档索引](README.zh-CN.md)

## 范围与方法

[understand-me](../plugins/understand-me/README.zh-CN.md)、[docs-governance](../plugins/docs-governance/README.zh-CN.md)、[handoff](../plugins/handoff/README.zh-CN.md) 和 [spec-write](../plugins/spec-write/README.zh-CN.md) 是**纯 Skill 指令资源**。不新增原生后端、加载器、安装器或活动 profile 修改。`implemented` 表示经过下述演练的指令迁移，不表示自动发现、强制沙箱、无人值守／后台安全、任意模型遵循提示、打包或 profile 验收。

固定来源为 [codeasier/open-codeasier 修订 20194ff7a7b26fd51965e50bdb5091cb37a4c0f5](https://github.com/codeasier/open-codeasier/tree/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills)。已读取四份 workflow-source 原文及递归目录树。没有外部资源引用；handoff 的内嵌模板保留为本地资源。每项资产保留来源／修订署名及完整上游 MIT 声明，Copyright (c) 2026 codeasier。

[行为测试](../test/workflow-skills.test.mjs)与[仅测试夹具](../test/helpers/workflow-skill-fixture.mjs)将实际 SKILL.md 文本交给公开生产 DSH AgentLoop。确定性本地 LLM 适配器遵循显式编写的场景；公开原生问答服务及原生 ask 工具实际验证 root／调用方身份、跳过／不可用／pending 回答和应答器事件。原生进程内夹具子代理把待确认问题交回 root。夹具 read/write/edit 工具操作一次性真实文件，通过快照、回读、操作记录和原生工具结果验证效果与错误。不调用真实 provider，不使用凭据、私有会话或付费模型。

这是实际执行的脚本化工作流演练，**不是任意模型能够自行推导或服从这些指令的评估**。夹具中的路径检查与文件系统约束仅保护测试数据，不保护真实 Skill 调用方。静态 frontmatter／资源／许可证检查补充行为执行，不替代行为验证。夹具仅用于测试，不是随产品交付的工作流解释器或通用 Agent 引擎。

## 演练行为

| 资产 | 实际场景与观察证据 |
|---|---|
| understand-me | 先读提供的证据；两个依赖有序的单项问题，包含自定义回答；单独确认共识，覆盖同意和拒绝；无实现授权、无写入。无应答器、跳过回答和原生限时 pending 结果保持未解决。 |
| 四项共同 | 原生 owned child 无法触达 root 应答器，捕获真实原生工具失败。子代理交回问题／推荐／理由，确认状态为 false；只有 root 随后提问并记录显式回答，不实现任何功能。 |
| docs-governance | 默认 audit 读取 README 双语、索引、包和 CLI 证据，报告断链／事实矛盾，文件快照完全相同。显式 fix 只修正已授权的两份双语链接；另行精确提出的结构修改被拒绝，不重命名、不修改其他文件。 |
| handoff 总结 | 更新前读取规范路径 `.agent/handoff/report-export/HANDOFF.md`，写入后回读；保留必需标题、ID／状态／时间、原有及新增历史、passed/failed/not-run 和历史证据。报告工作区／会话差异。 |
| handoff 失败／接续 | 非法、遍历、绝对、大小写、点、分隔符和多余参数名称在访问文件前拒绝。真实安全路径检查拒绝链接与悬空祖先。读取冲突及损坏文档，精确修复被拒绝后字节不变。缺失接续只报告规范路径和合法直接子名称。非目录祖先导致真实写失败，changed=false，回读 not-run。 |
| handoff 确认 | active/completed 接续读取当前工作区证据，忽略嵌入的授权／命令注入，拒绝后不继续。另一个 active 接续只在当前 root 显式确认后修改唯一夹具接续目标。completed 提供后续验证选项，不自动重启。 |
| spec-write | 读取产品证据，只按[规范例子](../plugins/spec-write/resources/package-example.md)生成并回读 spec.md/tasks.md/checklist.md。需求、任务依赖和验收映射保持 draft/pending、未勾选；产品字节不变。复用既有匹配包：歧义时零写入；后续显式调用方澄清只更新该 spec，保留其 ID／格式，不为元信息重写。 |

## 运行记录与限制

2026-10-04 使用 Node 22.22.3、pnpm 11.21.0 与固定公开 DSH 0.2.0-rc.2 依赖运行。既有依赖只读，没有安装。

```sh
node --test --test-concurrency=2 --test-name-pattern='understand-me|docs-governance|handoff|spec-write' test/workflow-skills.test.mjs
node --test --test-concurrency=2 test/workflow-skills.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
pnpm run build
pnpm run test:types
node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts
```

- **passed：** focused 仅行为演练，exit 0，实际执行 30 项。该运行完成前描述符始终为 scaffold。
- **passed：** 完整 focused：exit 0，31/31；`plugins:check`：exit 0，五个描述符；`test:plugins`：exit 0，13/13；`test:docs`：exit 0，4/4；build 与 types 各 exit 0。
- **passed，明确跳过：** 上述精确限并发命令执行全量离线回归，exit 0，157 项中 155 passed、零 failed、两个需主动开启的打包／profile 场景 skipped。跳过不等于验收 gate 通过。
- **failed，已调查：** 首轮负向名称过滤也匹配测试根，没有排除静态资产断言。28 项行为通过，但描述符仍为 scaffold 导致 exit 1。改用正向过滤并扩展行为测试，确认通过后才晋级 implemented；这不是将产品失败隐藏为成功。
- **not-run：** 一次性或活动 profile 中 Skill 安装／发现、打包资产验收、真实／付费模型行为、发布及更广 TUI 验收。不宣称这些 gate 已获支持。

集合原有 cross-review 后端、别名、持久化 schema、原生授权和聚合 patch 不变。集合测试保留 cross-review 强身份回归，不假定它是唯一插件；文档测试保留核心页面，并可组合新增 docs／插件双语页面。
