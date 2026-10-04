# DSH plugin collection architecture

[English](architecture.md) | [简体中文](architecture.zh-CN.md) | [Documentation index](README.md)

`dsh-codeasier` is one unreleased npm distribution containing independently composable DSH-native plugins and portable instruction assets. It is not a custom agent engine or an OpenCode compatibility runtime.

```text
package.json dsh.bundle.patch -> root cordis.patch.yml (flat Host entries)
                                      |
                      Native DSH / Cordis Loader
                                      |
               dsh-codeasier/plugins/<id> (Host)
                                      |
                  plugin-owned typed service
                          /           \
                   native tools     optional <id>/tui

plugins/<id>/plugin.json -> local list/check/scaffold tooling only
plugins/<id>/SKILL.md    -> instruction asset; no native activation
```

## Ownership and layout

- `src/plugins/<id>/index.ts`: canonical native Host module; exported `name`, `inject`, `Config`, `apply`. Internal services/types stay in that feature directory.
- `src/plugins/<id>/tui.ts`: optional version-sensitive adapter only. A Host never imports it, React or TUI at runtime.
- `plugins/<id>/`: repository descriptor, README, independent native patches or Skill assets. There is no descriptor-driven runtime auto-loader.
- `scripts/`: repository-only discovery, schema/patch/export validation and safe scaffolding. These scripts are not runtime package entrypoints.
- `test/`: plugin contract/regression tests plus collection/package/profile gates. Existing review tests keep their names during this source-only migration.
- `src/{host,tui,protocol,...}.ts`: compatibility forwarding modules. These retain export identity, not duplicate implementations. New features belong under `src/plugins`, never in these shims.
- Shared code should be extracted only after multiple plugins genuinely use it; cross-review's evidence/supervisor/storage internals are not a generic framework.

The root aggregate remains Host-only and preserves `id: cross-review` / `name: dsh-codeasier`. Future native plugins get separate Loader rows, initially disabled. Users configure, disable and dispose each row through the native public Loader contract. No custom nested `plugins` config, runtime registry, monkey-patch or generated model workflow is introduced.

## Three different manifests

1. `package.json`'s **native** `dsh.bundle.patch` selects the root patch. Public DSH accepts a string or ordered array of paths relative to the package root. We select one aggregate, not it plus overlapping standalone patches.
2. `plugins/<id>/plugin.json` is **repository-owned metadata**, schema version 1. It drives local tooling only. DSH does not auto-discover these descriptors, named configs, subpath bundles or Skill resources.
3. Package-root `dsh-plugin.json` is the existing **optional TUI Component manifest** for cross-review's adapter. Native Loader activation or repository metadata does not supply verified TUI Component identity. The current admission gap remains explicit.

Node exports expose modules/resources; they do not make `dsh-codeasier/plugins/<id>` an independently installed package or a valid package name in `dsh.profile.bundles`. Profile bundles refer to installed package roots. Resource exports resolve to files; native CLI `--patch` takes filesystem paths, not automatic npm-specifier lookup.

## Composition boundaries

- Choose either the package aggregate or a plugin's standalone insert patch. Do not mount legacy plus canonical aliases or compose duplicate inserts. Native patch composition does not reject duplicate IDs and Cordis does not deduplicate callback aliases.
- `id` is stable; a supplied `name` in an overlay is an exact-match guard. The root keeps the original name so existing guarded overlays still work. Canonical standalone composition uses the new name.
- A patch's `config` replaces the entire prior config; it is not deep-merged. Plugin-specific validated config layering, such as review invocation overrides, is distinct.
- `disabled: true` prevents native module import/activation. Optional dependencies are not loaded merely to list a catalog or disable a feature.
- Skill-only assets do not insert Loader rows or register tools. A prompt cannot enforce tool permissions, cancellation, cost authorization or crash recovery. Those belong to a native Host when required.

## Cross-review invariants

This refactor moves source ownership only. Tools/service IDs, immutable evidence, pre-execution native child bindings, execution-level guards, lifecycle/timer scheduling, cost policy, owner/revision controls, audit and durable recovery remain unchanged. Storage paths and schema/policy versions are not bumped; no persistence migration occurs. Full backend behavior is retained, not replaced with a Skill wrapper.

Current native delivery acceptance is `test:dsh-profile`. The stricter successful mediated-command/report-scene `test:tui-profile` remains separate and currently unmet. See [contracts](contracts.md), [TUI admission gap](tui-admission-gap.md) and [cross-review](../plugins/cross-review/README.md).
