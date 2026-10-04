# cross-review

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

Implemented, unreleased **DSH-native Host plugin**. Canonical entry: `dsh-codeasier/plugins/cross-review`.
Optional adapter: `dsh-codeasier/plugins/cross-review/tui`. Legacy aliases `dsh-codeasier`, `dsh-codeasier/tui` and `dsh-codeasier/protocol` remain available.

Load **one** Host entry, not both names: aliases share code, but Cordis creates a separate activation for each mounted entry. The stable Host Loader id remains `cross-review`; existing storage roots, record schema and tool names do not change.

## Composition

The package's `dsh.bundle.patch` selects the root Host-only aggregate. This preserves the original `name: dsh-codeasier` row, including name-guarded user overlays. `plugins/cross-review/cordis.patch.yml` is a standalone alternative using the canonical entry. **Do not compose both patches**: both insert `cross-review` and native composition does not reject duplicates for you.

Configuration is a native Loader overlay, not a new plugin manager setting:

```yaml
- id: cross-review
  config:
    root: /ABSOLUTE/PRIVATE/LOCAL/cross-review-state
    review:
      reviewers:
        - id: correctness
          provider: YOUR_PROVIDER
          model: YOUR_EXACT_MODEL
          focus: Correctness and regressions
          maxTokens: 4096
        - id: security
          provider: YOUR_PROVIDER
          model: YOUR_EXACT_MODEL
          focus: Security and evidence boundaries
          maxTokens: 4096
      concurrency: 2
      timeoutMs: 120000
      judge: { kind: parent }
```

These are placeholders, not working model routes. Native patch composition **replaces the entire `config` field**; it does not deep-merge separate config overlays. Supply all Host fields in one effective config. Reviewer configuration layering inside `CrossReviewService` is a separate, validated feature.

Disable the whole plugin with `- id: cross-review` / `disabled: true` in an overlay. The native Loader skips import/activation; no review tools, store or timers are created. Evidence, cost authorization, execution guards, judging, audit and recovery are mandatory internals, never independently disabled.

The optional `tui.patch.yml` is not in the default bundle. It requires this Host and the public TUI services; disable its row `cross-review-optional-tui` separately when disabling the Host. It is a composition resource, not a claim that DSH discovers per-plugin patches automatically or admits a manifested TUI Component. The package-root `dsh-plugin.json` still describes only this optional adapter. Current public admission limitations remain in [the verified gap](../../docs/tui-admission-gap.md).

## Tools and lifecycle

- `cross_review_preview`: validate exact model routes and immutable evidence without a model call.
- `cross_review_start`: native approval in an open owning-Agent turn; no dispatch before authoritative success.
- `cross_review_status`, `cross_review_report`, `cross_review_evidence`: owner-only read-only observations.
- `cross_review_judge`, `cross_review_control`: independent verification and revision-checked control/cleanup.

Plain DSH can expose `/review`; TUI mediated `/review` is optional and currently degrades to native-tool guidance. Only `report.complete === true` means complete. Majority quorum is completion policy, never proof of correctness. Parallel reviews increase model usage and cost.

Immutable evidence, native fresh children and scoped execution guards remain unchanged. Recovery reuses confirmed results, interrupts unknown work and never replays paid work automatically. No storage data migration is required by this repository reorganization.

## Verification

Existing `test/{evidence,protocol,native-driver,service,store,judge,lifecycle-races,tui}.test.*` remain cross-review's acceptance tests. `test/plugin-repository.test.mjs` verifies collection layout/exports/patch identities, scaffold safety and native disabled/disposal semantics. `test:package` verifies production exports; `test:dsh-profile` verifies supported native behavior in an isolated profile. The stricter `test:tui-profile` remains a separate unmet gate—not waived by the refactor.

See [architecture](../../docs/architecture.md), [contracts](../../docs/contracts.md) and [plugin development/migration](../../docs/plugin-development.md). No active-profile installation, release or paid review is implied.
