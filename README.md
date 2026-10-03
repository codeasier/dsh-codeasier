# dsh-codeasier

DeepSeek Harness-native workflow capabilities, starting with complete cross-review orchestration and optional dsh-TUI integration.

## Status

**Planning and repository bootstrap.** There is no runnable plugin, installation command, or build setup yet. The first roadmap will define the implementation and acceptance criteria for a complete plugin, not a Skill-only prototype.

## Initial scope

Build one DSH Host plugin that works independently of dsh-TUI. An optional TUI adapter consumes the same backend service; it must not own a second execution engine or state machine.

The first deliverable covers:

- Validated reviewer configuration, explicit per-reviewer provider/model selection, and no silent model fallback.
- Shared, fixed-version evidence for GitHub/GitCode PRs, revision ranges, and local changes.
- Fresh reviewer conversations, enforced read-only tools, and snapshot-scoped evidence access.
- Bounded concurrency, isolated failures, validated structured results, and a majority quorum of successfully completed reviewers.
- Explicit timeout preserve/abort decisions and cancellation of outstanding work.
- Parent-session or explicit-model judging: evidence verification, deduplication, and severity calibration rather than voting on findings.
- Durable run records, safe recovery, provenance, audit, cost authorization, and artifact retention/cleanup.
- Optional dsh-TUI configuration, progress, report viewing, and run controls.

Other workflow features are outside this initial scope.

## Architecture

```text
DSH tools / commands / Skill       Optional dsh-TUI adapter
              \                      /
                   CrossReviewService
                           |
       EvidenceGate / RunSupervisor / Judge / Audit / Recovery
                           |
            Native DSH subagents / jobs / storage
```

Use native DSH services for child execution and lifecycle handling. The plugin owns cross-review business rules and durable state. Background events advance runs; reading status must never be required to dispatch work or enforce deadlines.

Prefer one package with a Host entry and an optional TUI entry. The Host must not require TUI or React at runtime. A Skill is an invocation and review guide, not a security boundary or orchestration engine.

## Safety and recovery contracts

- Independent conversation history is not independent runtime or filesystem authority. Do not use forked parent conversations for reviewers.
- `meta.cwd` is not a filesystem sandbox. Bind each reviewer to immutable evidence before its first execution, using the exact native child identity.
- Reviewer evidence tools must reject path escapes, out-of-snapshot reads, VCS internals, and unsafe symlink traversal. Do not expose generic filesystem, shell, delegation, session-query, MCP, or network bypasses.
- Keep reviewer outputs outside the shared evidence namespace. Reviewers must not access one another's findings.
- Count only terminal, schema-valid reviewer results toward quorum. Partial output is diagnostic evidence, not a successful review. An empty findings array may be a valid completed result.
- Native job IDs and in-memory handles are not durable review identities. Persist a stable review run ID, snapshot identity, reviewer attempts, native child IDs, policy/schema versions, outcomes, pending decisions, and cancellation intent.
- Recovery must validate evidence and restore bindings before execution. Reuse confirmed completed results; classify unresolved work as interrupted. Never silently repeat paid model calls after a restart.
- DSH `approval: never` rejects approval requests; it is not a grant. Define startup consent and explicit headless preauthorization without bypassing a denial.
- Respect effective host policy, scope run controls to the owning runtime/session and project, and dispose children, timers, listeners, and storage handles.

## Compatibility baseline

The design investigation used DSH `0.2.0-rc.2` and dsh-TUI `0.12.0`. These are investigation baselines, **not an implemented compatibility guarantee**. Public-API contract tests must establish the supported version matrix before release.

Do not port OpenCode-specific SDK calls, model-driven status polling, permission ABI workarounds, or private storage access. Portable evidence and review policies may be adapted from [open-codeasier](https://github.com/codeasier/open-codeasier), with source/license attribution preserved.

## Development

Track implementation in the [GitHub issues](https://github.com/codeasier/dsh-codeasier/issues). Establish the critical permission, evidence-binding, structured-result, and recovery contracts before choosing build dependencies or advertising installation instructions.

## License

[MIT](LICENSE).
