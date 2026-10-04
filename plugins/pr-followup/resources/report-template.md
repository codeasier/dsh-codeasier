# PR follow-up evidence record

- Target: forge/repository/PR URL and number; authenticated identity (no secrets).
- Retrieval: time, endpoints/cursors/pages; metadata / reviews / threads / nested comments / inline comments / ordinary comments / linked issues completeness, including missing evidence.
- Baseline: base repository/ref/SHA; head repository/ref/SHA; fetched-object validation and local HEAD relationship.
- Workspace: absolute cwd/root/worktree, branch/HEAD, remotes, original staged/unstaged/untracked state; preserved paths/hunks.

| Feedback ID / URL / location | Classification | Evidence / canonical duplicate | Required / worthwhile / out of scope | Minimal change / test or clarification | Status |
|---|---|---|---|---|---|
| | valid / invalid / duplicate / ambiguous | | | | unresolved / locally fixed / checked / draft only |

| Check command | Exit | Outcome | Evidence / skipped or not-run reason |
|---|---|---|---|
| | | pass / fail / skipped / not-run | |

- Commit: exact intended files/hunks, reviewed diff and actual SHA (or no commit).
- Mergeability: value and retrieval time, or unknown and reason; local tests do not imply remote checks passed.

| Pending action | Exact repository/PR/destination/body or worktree/remote ref/old-new SHA/command | Consequences | Confirmation | Host policy | Execution / read-back receipt |
|---|---|---|---|---|---|
| reply / resolve / push / rebase / force-push | | | confirmed / cancelled / rejected / absent | allowed / denied / unavailable | not executed / success / confirmed absence / unknown outcome |

- Unresolved feedback and remaining limitations:
- Delegated caller handoff: return exact pending previews to the authorized caller; no implied remote operation.
