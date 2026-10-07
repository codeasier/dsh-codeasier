# Public contracts and acceptance

[English](contracts.md) | [简体中文](contracts.zh-CN.md) | [Documentation index](README.md)

This is an unreleased development package for issue #1. A green unit test is not a claim that an entire default profile, every model backend, or a published installation is supported.

## Verified contract target

Native packages are pinned to **DSH 0.2.0-rc.2** and Cordis 4.0.4. DSH was selected from npm `latest` for the original delivery; moving tags are not a compatibility guarantee. The delivery scope is the capabilities of that pinned release, not future manifested-command admission. Tests mount the published native AgentLoop, tool registry, fresh spawn backend, approval service and typed JSON domain storage. The only LLM adapter is a scripted local fixture: no provider credentials or paid reviews participate.

The optional adapter targets the **published dsh-TUI 0.12.0 public subpaths**. Actual status/scene mounting and command refusal are separate from successful ecosystem admission. The disposable profile explicitly includes `@deepseek-ai/dsh-agent-loop@0.2.0-rc.2` to align the loop/tool runtime cohort; its scripted native reviewers complete and progress renders. The adapter's own active fiber diagnostic now confirms command registration is refused because the calling activation has no verified `dsh-plugin.json` Component identity; mere Cordis Loader activation is not sufficient. The installed public composition has no supported Component admission bridge. Current-version acceptance uses `test:dsh-profile` to exercise genuine owning-Agent `cross_review_report`/`cross_review_control` calls after approved native reviewers complete, reject stale revisions without mutation, remove the terminal run/snapshot aggregate, and verify graceful Host disposal plus exact-path temporary HOME cleanup. It also verifies honest optional-TUI degradation without command fallback. `test:tui-profile` separately retains the broader full mediated-command/report-scene requirement; native Loader activation alone does not create a verified Component identity.

| Contract | Regression evidence |
|---|---|
| Fresh native child; exact child identity and evidence bound before first call | `native-contracts.test.mjs`, `native-driver.test.ts` asynchronous binding barriers |
| Read-only execution boundary; scoped registrations/PTC cannot bypass it | native driver tests, native monotonic guards and native structured capture |
| Frozen reviewer/model/schema/output cap; no route replacement | `protocol.test.ts`, `lifecycle-races.test.ts` caller mutation and Host routing cases |
| Fixed local/range/PR evidence; full diff; supplemental data cannot override it | `evidence.test.ts` Git fixtures, mocked public PR metadata, mutation/symlink/traversal/secret/binary cases |
| Bounded concurrency, isolated failure, terminal-only quorum and empty results | `service.test.ts`; no status polling drives work |
| Distinct reviewer identities; no votes; independently verified quotes and decisions | `judge.test.ts`, `lifecycle-races.test.ts` durable completion/quorum validation |
| Native open-turn cost authorization; never/denial/unavailable/cancellation rejected | `service.test.ts`; matching headless digest does not override the native answerer |
| Startup post-execution denial/replacement/shutdown cannot dispatch children | service and lifecycle tests; staged exact execution waits for authoritative final outcome |
| Timeout stops unfinished native work, then awaits preserve/abort | service and lifecycle tests; queued timeout superseded by cancel/disposal leaves reopened state, revision and audit unchanged; queued quorum failure cannot overwrite cancellation |
| Real cancellation, parent disposal and plugin disposal reach quiescence | native driver/service/lifecycle tests assert native registry and listener cleanup |
| Native durable results, hash/schema validation and no automatic paid replay | `store.test.ts`, `service.test.ts`, model-judge recovery lifecycle regression |
| Same-host cross-process ownership; revision-checked controls | native full-lifetime writer lock, independent subprocess lock fixture, stale-control regressions |
| Host without React/TUI; optional capability refusal and own disposal | actual Host mounting tests and `tui.test.ts` public seam/boundary tests |
| Pinned DSH review, native report/control tools, stale revision rejection, aggregate cleanup and disposal | `test:dsh-profile` real CLI/profile/PTY gate; unavailable optional command must show native guidance and stay unregistered |
| Successful ecosystem-admitted TUI command and report-scene consumption | Separate `test:tui-profile` full gate remains unmet on inspected pinned versions; never replace it with native-tool or negative Loader evidence |
| Original `/cross-review` Skill entry, split setup/review intent, fixed scoped files and confirmed native configuration writes | `cross-review-setup.test.ts` real Host registration, save/cancel/disposal, unsafe-path refusal and re-read validation; `service.test.ts` file/Host/invocation precedence and the unchanged evidence exclusion; Skill installation, profile acceptance and inference success are not claimed |
| Plugin descriptors, independent exports, legacy guarded overlays, disabled imports and safe local scaffolding | `plugin-repository.test.mjs`, `plugin-scaffold-boundaries.test.mjs`, `plugins:check`; repository metadata is not native/TUI admission |
| Tarball contents and production Host import without TUI/React | Separately enabled `test:package` gate with isolated HOME/store and public registry dependencies; not a release or active-profile installation |

## Interface provenance

The implementation uses public root exports and published declarations, not a private session database or an OpenCode transport:

- `@deepseek-ai/dsh-agent`: `AgentRegistry.create`, creation `setup`, awaited `agent/created`, `agent/disposed`, caller-owned factory lifetime and `AgentHandle.dispose`.
- `@deepseek-ai/dsh-subagent`: capability-validating `start('spawn', request)`, `toolFilter`, `outputSchema`, canonical request cancellation, terminal `result` and owned quiescent disposal. One-shot `interrupt()` is not cancellation.
- `@deepseek-ai/dsh-subagent-in-process-driver`: exported `STRUCTURED_OUTPUT_TOOL`. The unexported `attachStructuredRuntime` helper is deliberately not imported.
- `@deepseek-ai/dsh-tools`: `defineTool`, `restrict`, `presentAs('native')`, monotonic `guard`, and authoritative `tools/result`. Author value-schema DSL uses per-property `required:true`, unlike raw outputSchema JSON.
- `@deepseek-ai/dsh-llm`: public model catalog/resolution and final streaming boundary. Exact child session identity gates the frozen route/cap; administrative controllers cannot call models. Unrelated Host requests remain unaffected.
- `@deepseek-ai/dsh-user-approval`: public `request`, session override and configured policy. `allowed-once` is the only grant; native approvals require an open turn. The backend does not fabricate turns or insert a priority answerer.
- `@deepseek-ai/dsh-storage`, `dsh-storage-domain`, `dsh-storage-json`: a dedicated public native backend and domain facility route the known private root. The aggregate is validated before writes and again on reopen. JSON publication documents temporary-file fsync, rename and POSIX directory fsync.
- `@deepseek-ai/dsh-atomic-write`: `withFileLock` held **before opening the domain until close/drain**. Briefly locking cached updates would not protect against stale cross-process state. Utility `writeFileAtomic` is not confused with the native JSON fsync protocol. Scoped setup configuration uses the same public lock around exactly one atomic replacement (`writeFileAtomic`, mode `0600`); that utility documents crash durability (fsync) as out of scope, so setup claims atomic replacement, not crash durability.
- Optional TUI: type-only imports from `/plugin-host`, `/extensions`, `/scenes`; soft probes and actual registration acceptance. `registerCommand` uses the declared manifest contribution. Cordis documents `Fiber.ctx` as the actual plugin activation Context; a nonzero matching fiber UID proves activation ownership, not ecosystem admission. A grants probe borrowed from another plugin's async activation may itself be rejected, so it cannot replace registration evidence from the adapter's own activation. `Context.is` recognizes Cordis contexts across copies; `instanceof` mismatch alone does not explain a denial. The adapter emits a frozen `cross-review/tui-capabilities` diagnostic from its own activation; observer failures cannot change registration or disposal, and the diagnostic is not an authorization receipt. Diagnostics must not manufacture authorization with `extend()`. No `getHostAdmission`, `bindComponentIdentity`, root React import, raw terminal hook or private test helper is used.

Public package documentation is distributed with the pinned packages from the [DSH repository](https://github.com/deepseek-ai/deepseek-harness) and [dsh-TUI](https://www.npmjs.com/package/@deepseek-harness-tui/dsh-tui). The lockfile records exact resolved artifacts.

## State and ownership

A run moves from `running` to `awaiting_judge`, `awaiting_timeout`, `completed`, `failed`, `cancelled` or `interrupted`. Parent judging and timeout decisions are durable, not process-local job states. Quorum is `floor(configured reviewers / 2) + 1`, using distinct terminal schema-valid reviewer identities. A completed record must have no candidate finding still awaiting independent judgment.

Every control authenticates the exact live owning Agent and stable session/project/runtime ownership. Mutating controls check the expected revision again inside the serialized durable transition. Cleanup first claims a revision, then removes one aggregate containing the report and snapshot; it never computes a recursive workspace deletion.

Administrative controllers are native factory-owned children of the caller's scope. Their own pre-step gate rejects prompts and a final model gate forbids dispatch. Each real reviewer is a fresh native spawn child, independently scoped to immutable memory evidence before publication releases work.

No cross-host or cross-PID-namespace shared-state deployment is supported. The native writer lock is cooperative local ownership, not fencing, a distributed lease or remote cancellation transport. Domain reads are process-local cached observations; no cross-process job/RPC attachment is inferred.

## Recovery and retention

The durable domain is authoritative. Snapshot content, target/provenance, schema/policy versions, exact native bindings and terminal result contracts are validated before recovery. Confirmed completed results are reused; unknown attempts become interrupted. Unknown model judging makes the **run** interrupted rather than pretending a human decision is pending. Pending parent judgment and timeout decisions remain explicit.

Recovery never reloads a paid child, replaces the configured judge with a parent, or replays an unknown call. If unresolved model judging remains, a newly authorized run is required. Status/report APIs are read-only. Completed and interrupted artifacts are retained; owner-only terminal cleanup deletes the report and snapshot together. No automatic cleanup silently removes evidence needed for a pending decision.

## Deliberate limitations

- Evidence is UTF-8 text only, up to 8 MiB per file and 64 MiB for the file aggregate/diff. Rejection is explicit; a truncated review is not returned as complete.
- Unsafe symlinks, submodules, changed excluded/runtime/credential paths and command-bearing Git filters are rejected. Credential-like content scanning is fail-closed and can reject fixtures or examples as well as real secrets.
- Public GitHub/GitCode PR metadata and exact commit-object acquisition are implemented. Metadata shape tests use available local objects; real network Git-fetch acceptance is not inferred from mocked metadata. Authenticated/private metadata requires a separate Host preparation adapter and currently fails explicitly.
- Local two-pass capture detects mutation but is not a hostile ABA-proof filesystem transaction. Reviewers themselves never read the mutable filesystem after binding.
- Native cancellation is cooperative and quiescent, not a hard kill of arbitrary same-process code.
- Output caps are **per request**, not a currency or total-run spending limit. The plugin does not retry a failed orchestration attempt; effective native Host/provider request policy remains applicable.
- The TUI package bundles working-activity with older DSH/React peer declarations and runtime `workspace:*` manifests. Fresh and frozen pnpm installs are verified; npm clean installation rejects these manifests. Use the pinned pnpm package manager and lockfile. The disposable profile prepares the public profile manifest with the CLI's default base bundle and official hoisted/no-auto-peer workspace layout, then pins and verifies pnpm `11.21.0` before the official CLI installs packages; an empty Corepack HOME must not select a moving latest package-manager version. This ordinary profile configuration does not supply or bypass manifested Component admission. Dependency build scripts and implicit installs during `pnpm run` are disabled explicitly; no third-party package patch is applied. These facts are not hidden by claiming all shipped-profile features compatible.
