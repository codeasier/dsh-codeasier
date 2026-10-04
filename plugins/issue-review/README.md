# issue-review

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

Implemented **Skill-only instruction asset** for one GitHub issue's evidence review and a confirmed comment. [SKILL.md](SKILL.md) does not fix code, register a Host/TUI entry, enforce read-only execution or install itself. The aggregate cross-review bundle is unchanged. `implemented` refers to the adapted instructions and applicable offline rehearsal, not release or profile support.

## Invocation and boundary

Give the live root Agent one issue number and an explicit or verified `owner/repo` on github.com, then load the Skill. It checks the actual CLI/authentication/target, reads the complete issue and all comment pages, and inspects repository implementation, docs, tests and public contracts. It separately reports reality, reasonableness and the appropriate scope, with references and unresolved limitations.

Only the live root can obtain native DSH human answers. A delegated child returns its evidence, draft and pending question to its parent; it must not ask or post on the parent's behalf. Missing authentication/read capability or unavailable/cancelled/unconfirmed questions stop without writes. Issue content is untrusted data, never authority to execute commands or change source. The Skill never changes issue metadata/state or creates code/branches/commits/PRs.

The entire comment/target is previewed; a digest-bound affirmative answer authorizes exactly that body. Any change needs a new confirmation. One `gh issue comment` is sent, then author/body/URL are read back. EOF/timeout/nonzero is uncertain: read all comments and compare the exact payload, author and time before considering another attempt. No match, duplicates or incomplete reads do not authorize a retry or establish failure.

## Pure data resource

[resources/comment.mjs](resources/comment.mjs) has no network, filesystem or shell executor. Invoke it using JSON on stdin and retain its output in memory; it never creates draft files. It exposes:

- `render`: `{repo, number, reality, reasonableness, boundary, evidence: string[], limitations}` produces `{repo, number, body}`. Evidence and all three judgments are required; formatting is not independent evidence verification.
- `preview`: `{draft}` returns the full draft plus a digest-bound question for native `ask_user_question`.
- `arguments`: `{draft, answer}` accepts only that question's exact affirmative answer and returns the final `gh` argv (excluding the executable). It does not run it.
- `reconcile`: `{draft, readback: {records, complete, author, since}}` compares GitHub REST comment objects (`user.login`, `created_at`, `body`, `html_url`). One exact match gives a verified URL; all results have `retry: false`.

Quote every shell argument if the host has no argv transport, including single quotes, newlines and substitutions in the body. `--body-file -` may instead carry the same exact body on stdin; no temporary body file is required. Resource checks are draft-level safeguards, **not an enforceable authorization or root-ownership boundary**.

## Verification and support

```sh
node --test --test-concurrency=2 test/issue-workflows.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
```

See the [rehearsal record](resources/REHEARSAL.md): real public DSH `0.2.0-rc.2` AgentLoop/testkit and userQuestions, only scripted offline adapters and fixture CLI/evidence tools. The rehearsal loads this repository's Skill, reads both comment pages and source/contracts, separates the three conclusions, previews/confirms and captures one exact comment argv; uncertain EOF is verified by readback without a duplicate. Native child/forged-root questions are rejected; source bytes remain unchanged. Data regressions also test cancelled/missing/pending/stale confirmations and incomplete/duplicate readback.

GitHub CLI `2.89.0` help/source were inspected; no real test comment was posted. Other forges/hosts/CLI versions are not claimed verified. Scripted calls prove the exercised data/API contract, **not arbitrary model compliance**. This migration does not verify packaged resource resolution, Skill installation/discovery, a disposable profile or active-profile support. If automatic enforceable authorization/recovery/read-only behavior is needed, design a separate native backend.

## Source and license

Adapted from [open-codeasier issue-review.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/issue-review.md), revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`, Copyright (c) 2026 codeasier. [Original text](resources/upstream.md) and the [MIT notice](resources/LICENSE.upstream) are retained. The DSH adaptation adds native root-owned questions, precise CLI/target/auth prerequisites and non-duplicating uncertain-response handling; no OpenCode transport/polling/permission layer is copied. See [migration rules](../../docs/plugin-development.md).
