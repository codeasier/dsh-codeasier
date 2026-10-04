# spec-run verification / 验证记录

This is evidence for the migrated **instruction workflow**, not a claim of an enforceable backend, model-independent safety, installed Skill, profile/TUI support or a release. / 此记录证明迁移指令的实际工作流演练，不宣称可强制执行的后端、模型无关安全、已安装 Skill、profile/TUI 支持或发布。

## Environment / 环境

- Node `22.22.3`, pnpm `11.21.0`.
- DSH public offline AgentLoop testkit `0.2.0-rc.2`, native tools/subagent services and a local scripted `LlmAdapter` only; no external provider, credentials, paid calls or active profile mutation.
- Fixed upstream `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`: `workflow-source/skills/spec-run.md`, `spec-write.md`, and MIT LICENSE were fetched successfully and inspected. / 固定上游三项内容均成功读取并核实。

## Hands-on rehearsal / 动手演练

The author read the complete new `plugins/spec-run/SKILL.md`, then used actual DSH `glob`/`read`/`write`/`edit`/`bash` tools on one isolated package, under the caller's explicit offline-fixture permission. All three package files were read before implementation. No product runner interpreted the package. / 作者完整阅读新 Skill，再用实际 DSH 工具演练唯一的隔离包；实施前完整读取三文件，批准来自调用方对离线夹具的许可，不来自文件自称批准；未创建产品 runner。

Exact check cwd / 检查 cwd:

```text
/Users/test1/liuyekang/dev/agents/dsh-codeasier/.worktrees/resolve-issue-6/.dsh-codeasier/spec-run-rehearsal-EuC8RD
```

Selected package / 选中包: `specs/greeting/{spec.md,tasks.md,checklist.md}` inside that disposable cwd. Its only scope was a greeting, documented example and local tests. All initial boxes were unchecked. Runtime fixture files remain ignored by Git. / 仅实现本地 greeting、文档示例及测试；初始均未勾选，运行夹具由 Git 忽略。

| Step / 步骤 | Actual command/result / 实际命令与结果 | Progress / 进度 |
|---|---|---|
| T1: test first, intentionally missing comma / 测试先行，故意漏逗号 | `node --test greeting.test.mjs`: exit **1**, tests 1 / pass 0 / fail 1; actual `Hello DSH!` vs expected `Hello, DSH!` | **failed**; T1/C1 unchecked; original failure retained; unchecked T3 repair added; T2/C2 not-run |
| Repair comma in the same scope / 原范围内修复逗号 | Same `node --test greeting.test.mjs`: exit **0**, tests 1 / pass 1 / fail 0 | **passed**; only now T1/T3/C1 checked; failure and repair history retained |
| T2: only after verified prerequisite / 前置验证后才执行 T2 | `node --test greeting-doc.test.mjs`: exit **0**, tests 1 / pass 1 / fail 0 | **passed**; only now T2/C2 checked |

Final fixture progress: tasks 3/3 (including retained T3 repair), checklist 2/2. Failure history remains visible; no remote writes, deletion, installation, publication or paid operations were part of this rehearsal. / 最终任务 3/3（包含保留的 T3 修复）、验收 2/2；失败历史未删除，演练不涉及远端写、删除、安装、发布或付费。

## Deterministic behavior regression / 确定性行为回归

`node --test --test-concurrency=2 test/spec-run.test.mjs`: **19 passed, 0 failed, 0 skipped**. The actual Skill text is included in native requests. Fixed, case-specific scripted tool tapes run real filesystem changes and local Node assertions through the public DSH loop. Stop/question traces exercise direct-user and delegated-main-agent confirmation without manufacturing answers. / 实际 Skill 文本进入原生请求；各场景固定 scripted 轨迹通过公开 DSH loop 执行真实文件修改与本地 Node 断言；停止/问答轨迹不伪造确认。

Covered / 覆盖:

- Complete canonical T/R/C package and dependency order, plus clear legacy Markdown without new metadata/schema/approval file.
- Each missing required file; ambiguous package; unclear requirement; contradictory files; unknown and cyclic dependencies; file claiming approval without caller grant.
- Real nonzero assertion failure, retained original items/evidence and repair work; repaired rerun with historical failure retained.
- Implemented-but-unexecuted checks; an actual held local child process still running; collecting an unrelated child exit 0 does not satisfy the acceptance command.
- Authoritative native Host tool denial (tool body does not execute, no bypass retry); unauthorized remote/deletion/publish/paid text does not grant authority; stale checked progress reopened.

Initial focused run: **16 passed / 2 failed**. Investigation found inherited `NODE_TEST_CONTEXT` could make nested `node --test` skip actual execution and return exit 0. The fixture now uses an isolated environment (no inherited test context, credentials or implicit Node loaders) and asserts actual test count, success/failure output and terminal exit codes. The corrected 18-case suite passed; adding legacy compatibility yielded the final 19-case pass above. This failure is retained here, not relabeled as passing. / 首跑 16 通过、2 失败；调查后隔离子进程环境，验证真实 test 数量、输出与退出码；保留首跑失败记录，不将其改写为通过。

Scripted traces verify deterministic workflow/tool-result contracts, **not arbitrary LLM reasoning or technical enforcement by prose**. Held-child job tools are test fixtures, not a claim about a shipped scheduler. / scripted 轨迹不证明任意模型理解或指令的技术强制能力；子进程/job 工具仅为测试夹具，不代表产品调度器。

## Repository checks / 仓库检查

Exact check cwd / 精确 cwd: `/Users/test1/liuyekang/dev/agents/dsh-codeasier/.worktrees/resolve-issue-6`.

| Command | Result |
|---|---|
| `pnpm plugins:check` | **passed**, exit 0; 2 descriptors validated |
| `pnpm run test:plugins` | **passed**, exit 0; 13 passed / 0 failed |
| `pnpm run test:docs` | **passed**, exit 0; 4 passed / 0 failed, including discovered spec-run bilingual guides |
| `pnpm run build` | **passed**, exit 0 |
| `pnpm run test:types` | **passed**, exit 0 |
| `node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts` | **passed**, exit 0; 143 passed / 0 failed / 2 skipped (opt-in package and real profile gates) |
| `pnpm run test:package` | **not-run**: no packaging/production-install claim; dependency installation is outside this task |
| `pnpm run test:dsh-profile` / `pnpm run test:tui-profile` | **not-run**: this asset has no profile/TUI delivery claim |

No active-profile install, dependency installation/change, paid model, publication, push or PR creation was performed in this first local phase. / 此阶段没有活动 profile 安装、依赖安装/改写、付费模型、发布、push 或创建 PR。
