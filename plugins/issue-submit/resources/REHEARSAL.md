# issue-submit applicable rehearsal record

Scope: issue #7 migration on base `52f64d752198311d4933273f0040974aab905338`, branch `agent/resolve-issue-7`. Node `22.22.3`, pnpm `11.21.0`, public DSH AgentLoop/testkit/userQuestions `0.2.0-rc.2`. GitHub CLI `2.89.0` help and public source inspected read-only: `--template` cannot accompany `--body`/`--body-file`. Upstream text/MIT notice fetched at `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`.

Retained original Git blob verified identical to upstream: `f95f6a85b10147415bb1e569c9f8d3e6470b7cbf`; retained MIT notice is byte-identical to the repository's upstream-compatible LICENSE.

Executed: `node --test --test-concurrency=2 test/issue-workflows.test.mjs` — 14 passing, zero failed/skipped. The scripted rehearsal loads the actual Skill and drives production DSH tools/questions; it is separate from static descriptor/frontmatter checks.

Observed submit trace:

1. A genuine runtime root loaded repository `issue-submit/SKILL.md`; its text appeared in the following model request. Fixture auth/target/default-branch SHA checks preceded individual directory, legacy, config and each modern template read at the same fixture SHA.
2. Data preparation discovered a YAML form, Markdown template, legacy presence, disabled blank issues and a contact link. The native root question batch selected the form, collected reproduction, required checkbox consent and multiple components, and explicitly retained Version=1.0, Platform=macOS and default labels/assignees.
3. Rendering retained literal quotes/backticks/`$(...)` as data, used a longer textarea fence, omitted display-only malicious Markdown guidance, and emitted the optional no-response section. A full target/title/body/metadata question was previewed.
4. Exact native confirmation produced `issue create --repo fixture/project --title Zero division --body <exact-preview-body> --label bug --label '"needs,triage"' --assignee maintainer`. The captured argv contained no `--template` and exactly one fixture write, then a matching readback URL.
5. Cancelled final confirmation, missing question answerer and failed auth each captured zero writes. Simulated EOF after server acceptance captured one write followed by a matching readback, with `retry: false` and no duplicate.
6. Additional data cases exercised absent templates (permitted blank), legacy fallback, blank disabled/contact-only, 401/403/429/server/transport failure distinct from 404, malformed/unsupported template data, invalid required fields/dropdowns/checkboxes, defaults and explicit metadata replacement, stale/pending/missing confirmation, and incomplete/duplicate/wrong-author/payload/target readback. Local resource JSON-stdin entry points produced the same argv without writing drafts.

Only isolated evidence fixtures, in-memory gh/argv transport and scripted offline providers participated. No real test issue/comment, network write, paid model, dependency installation, active profile or publish. The rehearsal proves exercised data/public-DSH contracts, not general model compliance, live forge delivery, other platforms or packaged/disposable-profile Skill discovery/installation. `implemented` describes this adapted instruction asset, not a native backend or enforced authorization/recovery.

简体中文：实际离线演练使用真实公开 DSH root/testkit/问答，加载仓库 Skill，按固定 SHA 逐路径发现模板，取得字段和默认值决定，渲染完整预览并确认后捕获一次精确 argv，保留 labels/assignees 且不带 `--template`。取消、无问答和认证失败均零写入；模拟已接受后 EOF 先读回核验，不重发。没有真实投稿、付费模型、安装或 profile 变更；不据此宣称任意模型合规或真实平台/打包/profile 支持。
