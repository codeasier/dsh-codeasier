# dsh-codeasier

DSH-native independent code review, with one Host backend and an optional dsh-TUI adapter.

## Status

**Unreleased development implementation.** The backend, evidence gate, judging, durable recovery and optional adapter live in this repository; this is not a Skill-only prototype. Installation into an active profile and releases are intentionally not advertised. The current delivery targets the capabilities supported by npm-latest DSH `0.2.0-rc.2`, as requested; [Issue #1](https://github.com/codeasier/dsh-codeasier/issues/1) remains the broader roadmap. See the [contract and acceptance matrix](docs/contracts.md) for verification boundaries. The installed native TUI composition currently lacks the public manifested-Component admission step needed for `/review`; the [verified integration gap](docs/tui-admission-gap.md) records the own-activation refusal and public API boundary. Full TUI acceptance is not passing.

## Architecture

```text
Native tools / human commands        Optional TUI adapter
               \                         /
                    CrossReviewService
                             |
       Immutable evidence / supervisor / judge / audit / recovery
                             |
             Native DSH spawn and typed domain storage
```

- `dsh-codeasier` exports the Host entry and typed service; `dsh-codeasier/tui` is optional. The Host does not import React or TUI at runtime.
- Reviewer execution uses native fresh, one-shot subagents. A separate **undriven** administrative Agent supplies an unambiguous parent identity for each attempt; it never calls a model. The awaited child-creation hook durably binds the real child ID to immutable evidence before execution.
- Native tool restrictions plus a monotonic execution guard admit only snapshot reads and native `structured_output`. Generic filesystem, shell, network, MCP, delegation, session queries, scoped bypasses and `run_code` cannot execute. Reviewers never receive another reviewer's output.
- Native terminal results and backend timers advance bounded work. Status reads never schedule it. Only terminal, schema-valid results count toward majority quorum; valid empty findings count, partial output does not.
- Parent-session or explicitly configured model judging checks snapshot quotations, deduplicates canonical findings and records verification/rejection. Votes never establish correctness.
- One durable run aggregate contains configuration/provenance, snapshot bytes/hash, attempts and native IDs, results, pending decisions, authorization, revision, cancellation intent and audit. A full-lifetime native writer lock protects the actual storage root **on one host/PID namespace**. It is not a distributed lease.

## Configuration and invocation

The Host requires an absolute, private local `root` and explicit reviewer routes. `review` is the plugin configuration layer:

```json
{
  "reviewers": [
    { "id": "correctness", "provider": "YOUR_PROVIDER", "model": "YOUR_EXACT_MODEL", "focus": "Correctness and regressions", "maxTokens": 4096 },
    { "id": "security", "provider": "YOUR_PROVIDER", "model": "YOUR_EXACT_MODEL", "focus": "Security and evidence boundaries", "maxTokens": 4096 }
  ],
  "concurrency": 2,
  "timeoutMs": 120000,
  "judge": { "kind": "parent" }
}
```

These are placeholders, not a claim that those routes exist. Preview verifies the mounted model catalog and exact resolution, freezes effective configuration and reports each field's source. Invocation configuration overrides the Host layer. No silent model substitution is allowed at dispatch.

The native front door exposes:

- `cross_review_preview`: prepare `{target?, configuration?, notes?, pack?}` without model calls. Targets are local changes, a revision range, or public GitHub/GitCode PR URLs.
- `cross_review_start`: consume one preview after native startup cost approval.
- `cross_review_status`, `cross_review_report`, `cross_review_evidence`: owner-only, read-only observations and immutable parent-judging evidence.
- `cross_review_judge`, `cross_review_control`: owner- and revision-checked decisions, cancellation, timeout preservation/abort and terminal cleanup.

The supported entry point on current DSH is its native `cross_review_*` tool pipeline, available with or without TUI. The owning Agent can preview/start and then report/control a run through those tools. Plain DSH also exposes `/review` through its native command service. In a TUI host the optional adapter attempts mediated `/review` registration only when the public host admits it; current TUI `0.12.0` does not admit the installed native composition. It displays native-tool guidance instead—no unattributed command fallback or private identity binding. The command's `help` action describes the shared JSON grammar.

### Authorization and completion

Startup must run in a **genuine open parent turn**, because native approvals require one. An idle command does not fabricate a turn or change policy; it fails closed and directs the parent to the native startup tool. Only `allowed-once` grants startup, and work is dispatched only after the startup tool's authoritative final success. `approval: never`, unavailable approval, host denial, cancellation and rejected post-execution results do not start reviewers.

Explicit `preauthorizedDigests` record a single-use, exact-preview application grant for headless integrations. Startup still requires `ask` and a **separately composed, trusted native machine answerer** returning `allowed-once`; the backend never inserts an answerer to preempt a denial or unavailable mechanism. These grants cannot bypass `never` or native tool-policy denials. Provider charges are not estimated or bounded in currency; the approval names the frozen evidence, routes and configured output caps. No real paid model is used by tests.

A timeout stops unfinished work and persists a `preserve`/`abort` decision. Preservation uses confirmed results only and still requires quorum and judging; it does not restart paid work. Parent judgment remains pending until explicit verdicts arrive. **Only `report.complete === true` is a complete review.**

Recovery validates snapshot integrity and native bindings, reuses confirmed results and marks unknown attempts interrupted. It never automatically resumes an unknown paid call or silently replaces a model. Reports and snapshots are retained until owner-authorized cleanup; plugin disposal drains native children, listeners, timers and storage without installing anything into the user's profile.

## Evidence limitations

Preparation rejects rather than truncates unsupported evidence: binary/non-UTF-8 data, symlinks/submodules, unsafe paths, changed credential/runtime artifacts, command-bearing Git filters, oversized files (8 MiB) or snapshots/diffs (64 MiB). Supplemental packs cannot replace repository bytes. Public PR metadata is supported; authenticated/private preparation fails explicitly instead of reading or sending credentials. Local capture detects changes across two full passes; it is not an adversarial OS-atomic filesystem snapshot. Once bound, reviewers read immutable memory, not the changing workspace. SHA-256 supplies content integrity, not a secret-key signature.

## Development

The public native API contract target is DSH `0.2.0-rc.2`, verified as npm `latest` in this session; the optional adapter target is dsh-TUI `0.12.0`, also npm `latest`. The distinct DSH `alpha` tag (`0.2.1-alpha.1`) is not the default support target. Locked dependencies and actual contract tests—not the version numbers alone—define what has been verified. Development checks use Node `22.22.3` and pnpm `11.21.0`. Use pnpm: clean npm installation can reject the TUI package's bundled `workspace:*` dependencies. The workspace disables dependency build scripts and implicit installs during `pnpm run`; installation is a separate explicit step. The bundled TUI working-activity dependency declares older DSH/React peers; tests do not disguise those warnings as full-profile compatibility.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run test:contracts
pnpm run test:types
pnpm test
pnpm run check
```

Tests use disposable Git repositories, isolated state/HOME directories, real native services and scripted offline adapters. No credentials, private session databases, active-profile installation or paid review is needed. Packaging is a local verification operation, not a release.

`pnpm run check` skips the separately opted-in package and real TUI profile gates. After building, `pnpm run test:package` packs locally and installs production dependencies in a new temporary HOME/store with dependency scripts disabled; it needs registry access rather than an unrelated developer npm cache. `pnpm run test:dsh-profile` verifies currently supported native review/report/revision-control/cleanup in a real disposable DSH+TUI profile, accepting a denied optional command only with explicit fail-closed diagnostics and native-tool guidance. `pnpm run test:tui-profile` retains the stricter, currently unmet full mediated-command/report-scene gate. Both require Node 22, Python 3, a public DSH `0.2.0-rc.2` CLI and a locally built tarball. The disposable profile pins and verifies pnpm `11.21.0` before installation, rather than resolving a moving Corepack default. The default artifact is `.dsh-codeasier/package-acceptance/dsh-codeasier-0.0.0.tgz` (build, create that directory and pack locally with `npm pack --ignore-scripts --pack-destination .dsh-codeasier/package-acceptance`). `DSH_CODEASIER_TEST_CLI` and `DSH_CODEASIER_TEST_ARTIFACT` accept absolute overrides. The gate installs only into a new temporary HOME, explicitly aligns the native AgentLoop cohort, disables real providers and unrelated profile features, and exercises the actual TUI in a PTY. It must prove mediated `/review` registration, report rendering, revision rejection, cleanup and disposal before full TUI acceptance can be claimed.

This implementation is original. No OpenCode execution, polling or permission-compatibility layer is copied from [open-codeasier](https://github.com/codeasier/open-codeasier).

## License

[MIT](LICENSE).
