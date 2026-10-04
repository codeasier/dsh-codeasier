# issue-resolve Skill 资源

[English](README.md) | [简体中文](README.zh-CN.md) | [文档索引](../../docs/README.zh-CN.md)

[SKILL.md](SKILL.md) 提供 DSH 专属指令，在核实过的 Git worktree 中解决**一个明确 issue**。`plugin.json` 是仓库元数据（`kind: skill`、`status: implemented`），不是原生后端、Cordis patch 或安装器。implemented 仅表示指令资源和离线指令演练已交付，不代表强制隔离或模型遵从证明。包 bundle 和此描述文件都不会安装或启用 Skill。不包含活动 profile 安装、远端写入、付费评审或后台执行。

## 输入、能力与停止条件

通过已经核实的 forge 接口读取完整 issue 与全部评论，再读取仓库规范和相关代码、文档、测试。绑定仓库 origin、issue 编号/URL、本地完整基线 commit、专属分支和规范绝对 worktree 路径。编辑前明确实际 Git 与项目检查入口。使用可用的 DSH `read`/`glob`/`grep`、`edit`/`write`、显式 `workdir` 的 `bash` 和 `ask_user_question`；此资源不注册这些工具。可执行前置检查/验证示例需要 Git、Node 22+ 与 `/bin/bash`。Forge 能力和认证是调用方前置条件，不是本资源实现的适配器。

| 场景 | 必须行为 / 离线证据 |
|---|---|
| 缺失/多个 issue、origin/基线不匹配、缺少 issue 读取接口或检查入口 | 变更前停止；夹具执行 Skill 的实际前置检查并断言拒绝 |
| 新建专属 worktree | 核实规范 `.worktrees` 路径与未占用分支；实际从固定 SHA 执行 `git worktree add -b`；只在该目录编辑/检查 |
| 既有路径/分支或危险 symlink | 不 force、不覆盖、不猜测其他路径；夹具覆盖文件/目录、已注册/残留分支、链接父目录/目标与文件链接 |
| 用户明确指定的既有 worktree | 核对 Git 注册、common directory、分支和 HEAD；仓库/分支/基线错误或缺少归属授权则停止 |
| 既有用户 staged/unstaged/untracked 工作 | 脏的专属 worktree 停止；新 worktree 执行期间，脏源工作区的文件字节/index 保持一致；记录并保留 ignored 文件 |
| focused/full 失败或前置条件不可用 | 记录命令/cwd/退出码；focused 失败时 full 为 `not-run`；full 失败停止完成；保留文件，绝不回退主区 |
| 本地 commit / 远端操作 / 清理 | 用户要求本地提交时，仅在检查通过后提交具名任务文件；push 需明确请求；PR 和删除另需授权；不自动清理 |

这些是指导性指令及非对抗性命令演练。worktree、cwd 或 Skill 都不能强制提供 FS 边界；无法抵御并发替换路径。夹具不驱动 LLM、不连接 forge，也不证明人或模型必然遵从。它执行交付 Skill 中的指令片段，不只检查 frontmatter 或脚手架身份。文件 symlink 演练执行 Skill 的只读文件检查片段；本地提交演练直接使用文档约定的 Git 操作。静态测试另行检查元数据、署名与授权措辞。共享依赖 symlink 保持只读，不引入通用产品工作流 runtime。

## 离线回归

```sh
node --test test/issue-resolve.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
pnpm run build
pnpm run test:types
node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts
```

先运行 focused，再运行适用的集合/文档/build/types/全量 gate。报告真实 cwd、命令、退出码及 `passed`/`failed`/`not-run`，不能推断成功。测试创建隔离 HOME/config 的私有临时 Git 仓库，清理前验证精确的规范临时根目录；绝不删除用户 worktree。Profile/打包 gate 单独保留，此 Skill 的离线检查**不证明**它们通过；不宣称新的原生能力或安装支持。

## 来源、改编与许可

来源：[open-codeasier `workflow-source/skills/issue-resolve.md`](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/issue-resolve.md)，固定修订 `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`，Git blob `23f067cb557bbbb2fc5eeb759fc682346f4e8dd5`。保留其单 issue、先读取、专属 worktree、最小修复、回归、focused/full 与禁止未请求 push 的行为；新增 DSH 工具前置条件、仓库/commit/路径归属检查、用户工作保护、失败停止、独立副作用授权与证据示例。不复制 OpenCode 执行或权限兼容代码。

Copyright (c) 2026 codeasier。按 [MIT License](LICENSE) 改编，资源保留完整上游版权及许可声明。集合边界见[插件迁移指南](../../docs/plugin-development.zh-CN.md)。
