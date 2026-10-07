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

## Setup and optional Skill front door

The original [cross-review Skill](SKILL.md) guides native setup or review; it does not replace the backend or change `/review`. `/cross-review` becomes an available Skill only after separate, explicitly user-authorized Skill installation through a verified public DSH mechanism. Neither bundle loading nor repository metadata installs it; no installation command or TUI admission is implied. [cross-review-audit](../cross-review-audit/README.md) remains a separate read-only audit identity.

The Skill routes first-argument `setup`/`init` and explicit natural-language initialization intent to setup, never to review. Scope accepts positional `local`/`global` or `--local`/`--global`, defaults to local, and rejects contradictory scopes or unknown flags/arguments. Missing decisions and save confirmation go through `ask_user_question` at the exact live runtime root; children return pending questions to that root.

Four independently registered native tools perform setup without model calls or reviewers:

- `cross_config_catalog {}`: list all mounted providers and exact models, grouped by provider. Recommendations do not auto-select routes.
- `cross_config_preview {scope, configuration}`: require reviewer choices, fill defaults and return `setupId`, `path`, `exists`, `configuration`, `effectiveConfig`, `sources`, `expiresAt` without writing.
- `cross_config_save {setupId}`: after explicit human confirmation, request native open-turn approval for the full selection and exact create/replace path; honor host policy and refusal.
- `cross_config_validate {scope}`: re-read the saved file and check runtime schema, effective configuration, catalog and exact resolution—not credentials or successful inference.

Writes use native atomic replacement with mode `0600`, reject unsafe symlink/hardlink paths, and recheck the preview's file/layer state. Configuration files must be valid UTF-8 JSON no larger than 1 MiB. Atomic replacement is not a crash-durability/fsync or adversarial filesystem-isolation guarantee.

Choose reviewer `id`, `provider`, `model`, `focus`, optional `maxTokens`, optional model judge (otherwise parent), concurrency and timeout. Native defaults are concurrency `2`, timeout `120000` ms and parent judge; reviewers have no default. Preview the full selection, existing-file replacement and effective overrides before confirming. Cancel/missing confirmation never saves. Setup never calls `cross_review_*`, starts a review, falls back to generic FS/shell writes or bypasses headless/host approval policy. On capability/read/approval/write/validation failure, stop and preserve state; malformed existing files are refused, not silently overwritten. A post-write validation failure is not successful setup or permission to roll back another writer.

Local configuration is fixed at `cwd/.dsh/cross-review.json` under the owning Agent's **canonical cwd**; global configuration is at canonical `homedir/.dsh/cross-review.json`. There is **no upward project search**: worktrees are independent, and the evidence target does not change the local file. These paths are distinct from the Host's private run-storage `root`.

**Before local review:** the existing fail-closed evidence policy rejects changed or untracked `.dsh` runtime files, including configuration. Keep `cwd/.dsh/cross-review.json` untracked and **Git-ignored** in that worktree; an ignore rule does not exempt changed tracked runtime files. Setup validation checks configuration, not successful review-evidence capture. Setup never edits `.gitignore` or `.git/info/exclude`, stages/untracks files or automatically chooses an ignore policy; the user must separately choose and authorize that policy. Global configuration outside the project needs no project ignore step. Other changed/untracked runtime files remain subject to evidence rejection.

Effective precedence: **defaults < global file < local file < Host overlay < invocation**. Reviewer arrays replace, not concatenate; model-judge fields merge until the kind changes, and parent clears model-judge fields. Setup previews show the effective file/Host layers; invocation overrides are shown by a later review preview. Configuration updates affect new previews, not already frozen previews/runs. Setup approval never authorizes paid review.

### First-run pitfalls

Two first-run conditions can block work or mask saved settings.

**The owning session's effective approval policy must be able to ask.** Where a profile runs with approval policy `never` — a common "full access, no prompts" setup — configuration saves and review startups cannot proceed: each requires one native `allowed-once` decision for the exact selection or the frozen paid plan, and `never` is a rejection, not blanket permission. The stages have different diagnostics:

- `cross_config_save`: `Configuration authorization denied by host policy` under `never`; `Native configuration authorization is unavailable` when no approval service is mounted. A mounted service with no available answerer instead yields `Configuration authorization unavailable`.
- `cross_review_start`: `Review cost authorization rejected` under `never`; `Native startup authorization is unavailable` when no approval service is mounted. A mounted service with no available answerer instead yields `Review cost authorization unavailable`. `rejected` can also mean explicit denial under `ask`, so the error alone does not identify the effective policy.

Approval policy is independent of the file-sandbox mode, because neither operation is sandbox-bounded: setup replaces one fixed path through the Host's own atomic write, and startup dispatches paid provider calls. A fully open sandbox therefore grants neither consent. Retry in a session whose effective policy is `ask`, using a consent-capable session permission mode. Profiles mounting `permission-presets`, including the shipped base bundle, also need compatible preset composition: its shipped table has no `danger-full-access`/`ask` pair, so changing only the `approval` row can make `permission-presets` refuse mounting. If retaining the full-access sandbox, separately configure a matching ask-capable preset and `defaultPreset`; choosing a preset that pins `never` still does not enable consent. Setup never changes the profile. Never route around the refusal with generic file/shell writes: a hand-written `cross-review.json` carries no `allowed-once` authorization record. Headless preauthorization still requires `ask` plus a separately composed, trusted native answerer.

**A Host overlay outranks the file just saved.** Under defaults < global file < local file < Host overlay < invocation, a profile patch carrying a `cross-review` row with a complete `review` block can leave setup saved and validated while every effective field still comes from that overlay: preview and validation report `sources: host-plugin` per key and the file changes nothing. Partial overlays mask only the keys they supply: a Host `concurrency` override can win while file reviewers and timeout remain effective. Compare `effectiveConfig` and per-field `sources` — not the submitted `configuration` — before assuming which file settings apply. Making masked file keys effective requires separately editing or removing those overlay fields; setup never touches the profile.

## Tools and lifecycle

- `cross_review_preview`: validate exact model routes and immutable evidence without a model call.
- `cross_review_start`: native approval in an open owning-Agent turn; no dispatch before authoritative success.
- `cross_review_status`, `cross_review_report`, `cross_review_evidence`: owner-only read-only observations.
- `cross_review_judge`, `cross_review_control`: independent verification and revision-checked control/cleanup.

Plain DSH can expose `/review`; TUI mediated `/review` is optional and currently degrades to native-tool guidance. Only `report.complete === true` means complete. Majority quorum is completion policy, never proof of correctness. Parallel reviews increase model usage and cost.

Immutable evidence, native fresh children and scoped execution guards remain unchanged. Recovery reuses confirmed results, interrupts unknown work and never replays paid work automatically. No storage data migration is required by this repository reorganization.

## Verification

`test/cross-review-setup.test.ts` covers native setup registration, scoped file loading, confirmation/cancellation/disposal, safe replacement and runtime re-read validation with offline fixtures; `service.test.ts` checks file/Host/invocation precedence while preserving the evidence exclusion. These are not installed Skill discovery or real-provider inference acceptance. Existing `test/{evidence,protocol,native-driver,service,store,judge,lifecycle-races,tui}.test.*` remain cross-review's acceptance tests. `test/plugin-repository.test.mjs` verifies collection layout/exports/patch identities, scaffold safety and native disabled/disposal semantics. `test:package` verifies production exports; `test:dsh-profile` verifies supported native behavior in an isolated profile. The stricter `test:tui-profile` remains a separate unmet gate—not waived by the refactor.

See [architecture](../../docs/architecture.md), [contracts](../../docs/contracts.md) and [plugin development/migration](../../docs/plugin-development.md). No active-profile installation, release or paid review is implied.
