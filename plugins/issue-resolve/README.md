# issue-resolve Skill asset

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

[SKILL.md](SKILL.md) contains DSH-specific instructions for resolving **one explicitly identified issue** in a verified Git worktree. `plugin.json` is repository metadata (`kind: skill`, `status: implemented`), not a native backend, Cordis patch or installer. Implemented means the instruction asset and its offline command rehearsals are delivered, not enforced isolation or model-level compliance. Neither the package bundle nor this descriptor installs or enables the Skill. No active-profile installation, remote write, paid review or background execution is included.

## Inputs, capabilities and stops

Read the complete issue and comments through a verified forge interface, plus repository guidance and related code/docs/tests. Bind the repository origin, issue number/URL, full local base commit, dedicated branch and canonical absolute worktree path. Know the actual Git and project check entrypoints before edits. Use available DSH `read`/`glob`/`grep`, `edit`/`write`, `bash` with explicit `workdir`, and `ask_user_question`; this asset registers none of those tools. On pinned DSH `0.2.0-rc.2`, questions require the exact live runtime root: an owned child returns missing choices/confirmations to the main/root Agent rather than waiting for a human reply or treating pending/unavailable questions as authorization. The executable preflight/verification examples need Git, Node 22+ and `/bin/bash`. Forge support and authentication are caller prerequisites, not an adapter implemented here.

| Situation | Required behavior / offline evidence |
|---|---|
| Missing/multiple issue, origin/base mismatch, missing issue reader or check entrypoint | Stop before mutation; fixture runs the Skill's actual preflight and asserts refusal |
| New dedicated worktree | Verify canonical `.worktrees` path and unused branch; real `git worktree add -b` from pinned SHA; edits/checks only there |
| Existing path/branch or unsafe symlink | Refuse without force, overwrite or guessed alternate path; fixtures cover file/directory, registered/stale branch, linked parent/target and file symlink |
| Explicitly assigned existing worktree | Match Git registration, common directory, branch and HEAD; wrong repository/branch/base or missing assignment stops |
| Existing staged/unstaged/untracked user work | Dirty assigned worktree stops; a dirty source checkout stays byte/index-identical while a new worktree is used; ignored files are inventoried and preserved |
| Focused/full failure or unavailable prerequisite | Capture command/cwd/exit code; focused failure leaves full `not-run`; full failure stops completion; preserve files and never fall back to main |
| Local commit / remote operations / cleanup | Only named task files in a requested local commit after passing gates; push requires explicit request; PR and deletion need separate authorization; no automatic cleanup |

These are advisory instructions and non-adversarial command rehearsals. A worktree, cwd or Skill cannot enforce an FS boundary; concurrent path replacement is not race-proof. The fixture suite does not drive an LLM, contact a forge or prove human/model compliance. It executes the snippets from the shipped Skill rather than testing only frontmatter or scaffold identity. File-symlink rehearsals execute the Skill's read-only file-inspection snippet; local-commit rehearsals use the documented Git operations directly. Static tests separately check metadata, attribution and authorization wording. Shared dependency symlinks remain read-only, and no generic product workflow runtime is introduced.

## Offline regression

```sh
node --test test/issue-resolve.test.mjs
pnpm plugins:check
pnpm run test:plugins
pnpm run test:docs
pnpm run build
pnpm run test:types
node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts
```

Run the focused suite first, then the applicable collection/docs/build/types/full gates. Report actual cwd, commands, exit codes and `passed`/`failed`/`not-run`, not inferred success. Tests create private temporary Git repositories with isolated HOME/config and verify exact canonical temporary roots before cleanup; they never remove a user's worktree. Profile/packaging gates are separate and are **not** proven by this Skill's offline checks; no new native capability or install support is claimed.

## Source, changes and license

Source: [open-codeasier `workflow-source/skills/issue-resolve.md`](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/workflow-source/skills/issue-resolve.md), fixed revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`, Git blob `23f067cb557bbbb2fc5eeb759fc682346f4e8dd5`. Its one-issue/read-first/worktree/minimal-fix/regression/focused-full/no-unsolicited-push behavior is retained. Added DSH tool prerequisites, repository/commit/path ownership checks, user-state preservation, failure stops, separate side-effect authorization and evidence examples. No OpenCode execution or permission compatibility code is copied.

Copyright (c) 2026 codeasier. Adapted under the [MIT License](LICENSE); the complete upstream copyright and permission notice is retained with this asset. See [plugin migration guidance](../../docs/plugin-development.md) for collection boundaries.
