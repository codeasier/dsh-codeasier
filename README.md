# dsh-codeasier

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](docs/README.md)

An extensible **DSH-native plugin collection**. `cross-review` is the first implemented plugin, with a complete Host backend and an optional dsh-TUI adapter. Future Skills and OpenCode features can migrate independently; this is not an OpenCode compatibility layer.

## Plugin repository

One npm package, independent native plugin entries and declarative Cordis composition—no new runtime loader or agent engine.

| Plugin | Canonical entry | Scope |
|---|---|---|
| [cross-review](plugins/cross-review/README.md) | `dsh-codeasier/plugins/cross-review` | Native review/report/control, evidence and durable recovery |
| cross-review optional TUI | `dsh-codeasier/plugins/cross-review/tui` | Optional public UI capabilities; mediated command admission remains limited |
| [understand-me](plugins/understand-me/README.md) | `plugins/understand-me/SKILL.md` | Skill-only: one-question decisions and confirmed consensus |
| [docs-governance](plugins/docs-governance/README.md) | `plugins/docs-governance/SKILL.md` | Skill-only: zero-write audit or authorized scoped fixes |
| [handoff](plugins/handoff/README.md) | `plugins/handoff/SKILL.md` | Skill-only: canonical handoffs and confirmed intake |
| [spec-write](plugins/spec-write/README.md) | `plugins/spec-write/SKILL.md` | Skill-only: spec/tasks/checklist package, no product implementation |
| [spec-run](plugins/spec-run/README.md) | `plugins/spec-run/SKILL.md` | Instruction-only: one approved spec package, dependency order and verified task/checklist progress; no auto-install |
| [issue-review](plugins/issue-review/README.md) | `plugins/issue-review/SKILL.md` | Skill-only evidence review and explicitly confirmed GitHub comment; no code edits |
| [issue-submit](plugins/issue-submit/README.md) | `plugins/issue-submit/SKILL.md` | Skill-only template discovery, required fields, complete preview and confirmed GitHub submission |
| [issue-resolve](plugins/issue-resolve/README.md) | `plugins/issue-resolve/SKILL.md` | Skill-only: one issue, verified worktree, user-state preservation and focused/full check evidence; no enforced FS boundary or installation |
| [pr-followup](plugins/pr-followup/README.md) | `plugins/pr-followup/SKILL.md` | Independent instruction asset: complete feedback triage, minimal fixes and separately confirmed remote actions; no backend or auto-install |
| [cross-review-audit](plugins/cross-review-audit/README.md) | `dsh-codeasier/plugins/cross-review-audit` | Opt-in, owner-only read-only run/evidence/report contract audit; no models |

```text
src/plugins/<id>/          # feature-owned Host/service; optional tui.ts
plugins/<id>/              # descriptor, README, native patches or Skill assets
scripts/                   # local catalog validation and scaffolding
src/host.ts, tui.ts, ...    # legacy compatibility forwarders
cordis.patch.yml           # flat Host-only aggregate bundle
```

```sh
pnpm plugins:list
pnpm plugins:check
pnpm plugin:new session-review
pnpm plugin:new handoff-notes --kind skill
```

Run these after the explicit dependency installation below. Scaffolds are marked unimplemented; new native patches are disabled and not automatically added to the aggregate. Skill-only assets do not register a backend or install themselves. These commands only create/check repository files—no active-profile installation or model calls.

The existing `dsh-codeasier`, `/tui` and `/protocol` exports remain compatibility aliases. The default bundle keeps cross-review's original Loader id/name, tool IDs and state format; cross-review-audit is present but disabled by default. **Choose one alias/patch per plugin; do not mount old and new entries together.** `plugins/<id>/plugin.json` is local repository metadata, not DSH's native bundle manifest or the optional TUI Component manifest.

Start with [plugin development and migration](docs/plugin-development.md), [architecture](docs/architecture.md), and [cross-review configuration](plugins/cross-review/README.md).

The issue Skills use live-root DSH questions and the inspected github.com/gh `2.89.0` contract. Child Agents return pending questions; no explicit confirmation means no issue/comment write. Their pure data resources and offline scripted rehearsals are not native authorization/recovery enforcement, installed Skill discovery or verified package/profile support. See each guide for prerequisites and limitations.

## Status

**Unreleased development implementation.** The backend, evidence gate, judging, durable recovery and optional adapter live in this repository; this is not a Skill-only prototype. Installation into an active profile and releases are intentionally not advertised. The original delivery selected DSH `0.2.0-rc.2` from npm `latest`; its pinned capabilities define this scope, not today's moving registry tag. [Issue #1](https://github.com/codeasier/dsh-codeasier/issues/1) remains the broader roadmap. See the [contract and acceptance matrix](docs/contracts.md) for verification boundaries. The installed native TUI composition currently lacks the public manifested-Component admission step needed for `/review`; the [verified integration gap](docs/tui-admission-gap.md) records the own-activation refusal and public API boundary. Full TUI acceptance is not passing.

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

- `dsh-codeasier/plugins/cross-review` exports the Host entry and typed service; its `/tui` entry is optional. The legacy root exports forward to the same implementation. The Host does not import React or TUI at runtime.
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

The pinned public native API contract target is DSH `0.2.0-rc.2`; the optional adapter target is dsh-TUI `0.12.0`. These were selected from npm `latest` for the original delivery; moving registry tags are not a compatibility guarantee. The separate DSH `alpha` line is not the default support target. Locked dependencies and actual contract tests—not the version numbers alone—define what has been verified. Development checks use Node `22.22.3` and pnpm `11.21.0`. Use pnpm: clean npm installation can reject the TUI package's bundled `workspace:*` dependencies. The workspace disables dependency build scripts and implicit installs during `pnpm run`; installation is a separate explicit step. The bundled TUI working-activity dependency declares older DSH/React peers; tests do not disguise those warnings as full-profile compatibility.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run test:contracts
pnpm run test:types
pnpm run test:docs
pnpm test
pnpm run check
```

Tests use disposable Git repositories, isolated state/HOME directories, real native services and scripted offline adapters. No credentials, private session databases, active-profile installation or paid review is needed. Packaging is a local verification operation, not a release.

`pnpm run check` skips the separately opted-in package and real TUI profile gates. After building, `pnpm run test:package` packs locally and installs production dependencies in a new temporary HOME/store with dependency scripts disabled; it needs registry access rather than an unrelated developer npm cache. `pnpm run test:dsh-profile` verifies currently supported native review/report/revision-control/cleanup in a real disposable DSH+TUI profile, accepting a denied optional command only with explicit fail-closed diagnostics and native-tool guidance. `pnpm run test:tui-profile` retains the stricter, currently unmet full mediated-command/report-scene gate. Both require Node 22, Python 3, a public DSH `0.2.0-rc.2` CLI and a locally built tarball. The disposable profile pins and verifies pnpm `11.21.0` before installation, rather than resolving a moving Corepack default. The default artifact is `.dsh-codeasier/package-acceptance/dsh-codeasier-0.0.0.tgz` (build, create that directory and pack locally with `npm pack --ignore-scripts --pack-destination .dsh-codeasier/package-acceptance`). `DSH_CODEASIER_TEST_CLI` and `DSH_CODEASIER_TEST_ARTIFACT` accept absolute overrides. The gate installs only into a new temporary HOME, explicitly aligns the native AgentLoop cohort, disables real providers and unrelated profile features, and exercises the actual TUI in a PTY. It must prove mediated `/review` registration, report rendering, revision rejection, cleanup and disposal before full TUI acceptance can be claimed.

The cross-review implementation is original. Migrated instruction assets adapt MIT-licensed [open-codeasier](https://github.com/codeasier/open-codeasier) prose at revision `20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`; each guide retains source and license attribution. No OpenCode execution, polling or permission-compatibility layer is copied. The first batch's [offline rehearsal boundaries](docs/workflow-skills-verification.md) do not imply automatic installation or enforceable/background safety.

The independent [cross-review-audit guide](plugins/cross-review-audit/README.md#attribution-and-migration) records its semantic/instruction adaptation and retained MIT notice; no OpenCode run-store is copied.

## License

[MIT](LICENSE).
