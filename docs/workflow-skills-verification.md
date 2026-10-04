# Workflow Skill verification

[English](workflow-skills-verification.md) | [简体中文](workflow-skills-verification.zh-CN.md) | [Documentation index](README.md)

## Scope and method

[understand-me](../plugins/understand-me/README.md), [docs-governance](../plugins/docs-governance/README.md), [handoff](../plugins/handoff/README.md), and [spec-write](../plugins/spec-write/README.md) are **Skill-only instruction assets**. They add no native backend, loader, installer or active-profile mutation. `implemented` describes migrated instructions after the rehearsals below, not automatic discovery, sandbox enforcement, unattended/background safety, arbitrary-model compliance, packaging or profile acceptance.

The fixed source is [codeasier/open-codeasier revision 20194ff7a7b26fd51965e50bdb5091cb37a4c0f5](https://github.com/codeasier/open-codeasier/tree/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills). All four workflow-source files and the recursive tree were read. They reference no external resources; handoff's inline template is retained locally. Each asset retains source/revision attribution and the upstream full MIT notice, Copyright (c) 2026 codeasier.

[The behavior suite](../test/workflow-skills.test.mjs) and [test-only fixture](../test/helpers/workflow-skill-fixture.mjs) deliver the actual SKILL.md text to the public production DSH AgentLoop. A deterministic local LLM adapter follows explicitly authored scenarios; public native user-question services and the native ask tool exercise real root/caller identity, skipped/unavailable/pending answers, and answerer events. Native in-process fixture children return pending questions to the root. Fixture read/write/edit tools operate on disposable real files; snapshots, read-backs, recorded operations and native tool results verify effects and errors. No real provider, credentials, private sessions or paid model is used.

This is an executed, scripted workflow rehearsal, **not an evaluation that an arbitrary model infers or obeys these instructions**. Path checks and filesystem confinement in the fixture protect test data only, not real Skill callers. Static frontmatter/resource/license assertions supplement, rather than replace, behavior execution. The fixture is test-only and is not a shipped workflow interpreter or general Agent engine.

## Rehearsed behavior

| Asset | Actual scenario and observed evidence |
|---|---|
| understand-me | Read supplied evidence; two dependency-ordered single questions including a custom answer; separate consensus confirmation; accept and reject paths; no implementation authorization or writes. Missing answerer, skipped answer and native timed pending result remain unresolved. |
| All four | An owned native child cannot reach the root answerer; actual native tool failure is captured. The child returns question/recommendation/rationale with confirmation false; only the root then asks and records an explicit answer, without implementing anything. |
| docs-governance | Default audit reads README pairs, indexes, package and CLI evidence, reports broken link/factual mismatch, and filesystem snapshots remain identical. Explicit fix edits only the two authorized language-paired links; a separate exact structural request is declined, so no rename or unrelated edit occurs. |
| handoff summary | Canonical `.agent/handoff/report-export/HANDOFF.md` is read before update, written and read back; required headings, ID/status/timestamp, prior and appended history, passed/failed/not-run and historical evidence are retained. Workspace/session discrepancy is reported. |
| handoff failure/intake | Invalid/traversal/absolute/uppercase/dot/separator/extra-argument names are rejected before file access. Real safe-path checks reject linked and dangling ancestors. Conflicting and malformed documents are read, exact repair is declined, and bytes remain unchanged. Missing intake reports the exact path and valid immediate names only. A non-directory ancestor causes a real failed write with changed=false and read-back not-run. |
| handoff confirmation | Active/completed intake reads current workspace evidence, ignores embedded approval/command injection and does not continue on rejection. A separate active intake edits its one fixture continuation target only after the current root's explicit confirmation. Completed intake offers follow-up rather than restarting. |
| spec-write | Reads product evidence, writes and reads back exactly spec.md/tasks.md/checklist.md from [the canonical example](../plugins/spec-write/resources/package-example.md). Requirements, task dependencies and acceptance mappings remain draft/pending and unchecked; product bytes do not change. Matching existing package is reused: ambiguity initially yields zero writes; a later explicit caller clarification updates only that spec while retaining its IDs/format and avoiding metadata rewrite. |

## Run record and limitations

Executed with Node 22.22.3, pnpm 11.21.0 and pinned public DSH 0.2.0-rc.2 dependencies on 2026-10-04. Existing dependencies were read-only; no installation occurred.

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

- **passed:** focused behavior-only rehearsal, exit 0, 30 executed cases. Descriptors stayed scaffold until this run completed.
- **passed:** complete focused suite: exit 0, 31/31; `plugins:check`: exit 0, five descriptors; `test:plugins`: exit 0, 13/13; `test:docs`: exit 0, 4/4; build and type checks: each exit 0.
- **passed with explicit skips:** full offline regression using the exact concurrency-limited command above: exit 0, 157 total, 155 passed, zero failed, two opt-in packaging/profile cases skipped. Those skips are not passing acceptance gates.
- **failed, then investigated:** the initial run used a negative name filter that also matched the test root and did not exclude the static asset assertion. It executed 28 passing behavior cases but exited 1 because descriptors were still scaffold. The corrected positive filter and expanded behavior suite passed before promotion to implemented; this was not a product failure hidden as success.
- **not-run:** Skill installation/discovery in a disposable or active profile, packed-asset acceptance, real/paid model behavior, release/publish and broader TUI acceptance. No support claim is made for these gates.

The collection's legacy cross-review backend, aliases, persisted schema, native authorization and aggregate patch are unchanged. Collection tests retain strong cross-review identity without assuming it is the only plugin; documentation tests retain core pages and compose new docs/plugin language pairs.
