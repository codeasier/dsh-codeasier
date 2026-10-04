# issue-review applicable rehearsal record

Scope: issue #7 migration on base `52f64d752198311d4933273f0040974aab905338`, branch `agent/resolve-issue-7`. Node `22.22.3`, pnpm `11.21.0`, public DSH AgentLoop/testkit/userQuestions `0.2.0-rc.2`. GitHub CLI `2.89.0` help and public create/comment contracts inspected read-only. Upstream original/notice were fetched at `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`; an initial review-source EOF succeeded on one read-only retry.

Retained original Git blob verified identical to upstream: `47ab09ab7d8fbff0cd92af49afee9fd0fd01cf9f`; retained MIT notice is byte-identical to the repository's upstream-compatible LICENSE.

Executed: `node --test --test-concurrency=2 test/issue-workflows.test.mjs` — 14 passing, zero failed/skipped. This is a reproducible scripted rehearsal, not merely frontmatter/keyword validation and not a claim of autonomous model judgment.

Observed review trace:

1. The production root Agent called the fixture `skill` tool; the following model request contained the full repository `issue-review/SKILL.md` text.
2. Fixture auth succeeded. The exact issue and both comment pages were read; source and API-contract fixture files were read, and the supplied divide-by-zero behavior was checked. The issue's instruction to edit/post without confirmation was treated as data.
3. The comment was rendered with separate Reality, Reasonableness and Boundary judgments plus evidence/limits. The complete body/target appeared in the native root question.
4. The native question service delivered the root's affirmative answer. The pure helper returned `issue comment 7 --repo fixture/project --body <exact-preview-body>`. The fixture captured exactly one write; no edit/delete/state/metadata flags appeared.
5. A simulated EOF after acceptance was resolved by a complete author/body/time/URL readback, with `retry: false`; there was no second write. Source bytes/hash stayed unchanged.
6. The native service rejected a forged live-root object (`CALLER_NOT_LIVE`) and a live spawned child (`DELEGATED_CALLER`); the child's structured result returned the pending confirmation question. No comment was written by that child. Cancelled/skipped/pending/stale confirmation and incomplete/duplicate readback also fail closed in resource regressions.

Only fixture tools and scripted offline adapters were mounted. No remote test comment/issue, paid adapter, active profile, install or publish. The fixture bash is an in-memory argv transport, not the user's shell; pure stdin resources additionally executed through local Node subprocesses. This verifies the exercised data and public DSH contracts, not general LLM compliance, real forge delivery, packaged Skill resource resolution or profile discovery/installation.

简体中文：本记录是针对迁移目标的实际脚本化离线演练。真实公开 DSH root 加载仓库 Skill、读取完整证据、区分三项结论、展示完整评论，经原生问答确认后仅捕获一次精确 argv；模拟 EOF 先读回，源码未改。伪造 root/child 问答被原生服务拒绝，子代理交回问题。没有真实投递、付费模型、安装或活动 profile 修改；不能据此宣称任意模型遵守指令或打包/profile 已支持。
