# Repository guidance

## Project goal

Maintain an extensible DSH-native plugin collection in one package. `cross-review` is the first implemented plugin; future features and instruction assets migrate independently.

- Native feature code belongs in `src/plugins/<id>/`; resources, repository-only descriptors and independent patches belong in `plugins/<id>/`.
- Compose plugins with flat native Loader entries, not a custom runtime registry or a model-generated orchestration engine. New optional features start disabled; scaffolds must remain explicitly unimplemented.
- Preserve legacy root/TUI/protocol aliases and the original aggregate `cross-review` id/name. Never mount aliases or overlapping insert patches together. Keep persisted state/schema unchanged for layout-only moves.
- Skill-only assets are not backend implementations and do not install themselves. Repository `plugin.json` metadata is distinct from native `dsh.bundle.patch` and optional TUI `dsh-plugin.json` admission.
- Run `plugins:check` and collection regression tests when adding plugins. See `docs/plugin-development.md` for migration and attribution rules.
- Keep reader-facing English and `zh-CN` documentation in sync, including both `docs/README` indexes. Run `test:docs`; this offline link/example regression supplements, but does not replace, a factual docs-governance audit. Do not restructure or rename externally referenced documentation paths without confirmation.

Implement complete DSH-native cross-review orchestration with an optional dsh-TUI adapter. The repository now contains an unreleased Host implementation, an optional TUI adapter, and offline contract/regression checks. The current delivery scope is capabilities supported by npm-latest DSH: native review/report/control tools with honest optional-TUI degradation. Verify `test:dsh-profile` before claiming that scope; the broader mediated-command `test:tui-profile` gate remains separate. No active-profile installation or release support is implied.

Do not reduce the first deliverable to a Skill-only prototype. Implementation may proceed in modules, but acceptance covers the complete backend, recovery/audit contracts, and TUI consumption.

## Architecture rules

- Keep the Host backend independent of TUI and React. All front doors use the same typed service and validated run controls.
- Prefer native DSH subagent/job/storage services over a custom general-purpose Agent engine or model-generated workflow scripts.
- Advance runs from backend lifecycle events and timers. Status queries are read-only and never drive scheduling.
- Use fresh reviewer conversations, not inherited parent history. Independently verify findings; quorum is a completion policy, not a vote on correctness.
- Use only confirmed public extension interfaces. Isolate version-sensitive TUI surfaces in the optional adapter; do not monkey-patch the host or inspect private session databases.

## Safety rules

- Bind immutable snapshot evidence before a reviewer can execute. Do not treat `meta.cwd`, a read-only prompt, or conversation isolation as a filesystem boundary.
- Enforce scoped evidence tools and an execution-level allowlist, including the required native structured-result capture capability. Reject traversal, unsafe symlinks, VCS internals, sibling outputs, and generic FS/shell/MCP/network/delegation/session-query bypasses.
- Persist stable run/attempt identities, exact native child IDs, evidence identity, schema/policy versions, terminal results, pending decisions, and cancellation intent.
- Validate evidence and reconstruct bindings before recovery. Reuse confirmed completed results. Unresolved work is interrupted; no automatic paid replay or silent model replacement.
- Honor effective host policy and explicit cost authorization. `approval: never` is rejection, not permission. Headless preauthorization must be explicit and must not bypass a denial.
- Validate control ownership and state revisions. Native process-local jobs are not a durable source of truth or a cross-process lease.
- Keep credentials, provider secrets, runtime artifacts, and local sessions out of Git.

## Development and verification

- Start with contract tests for public APIs, pre-execution evidence binding, tool/schema compatibility, authorization, cancellation, and crash recovery.
- Test both plain DSH without TUI and dsh-TUI consumption, including disposal and unavailable optional capabilities.
- Do not advertise supported versions, installation commands, or passing tests until they are verified.
- Preserve attribution and license notices when adapting portable code from open-codeasier. Do not copy its OpenCode transport, polling, or permission-compatibility layers.
- Keep changes scoped. Do not publish releases, install into the user's active profile, or run real paid reviews without an explicit request.
