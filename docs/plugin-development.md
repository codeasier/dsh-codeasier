# Adding and migrating plugins

[English](plugin-development.md) | [简体中文](plugin-development.zh-CN.md) | [Documentation index](README.md)

## Local development commands

```sh
pnpm plugins:list
pnpm plugins:check
pnpm plugin:new session-review
pnpm plugin:new handoff-notes --kind skill
pnpm run test:docs
pnpm run check
```

These are repository tooling commands, not installation commands. They never modify the active DSH profile, call models, publish, or enable generated plugins. Use unique lowercase kebab-case IDs. Existing files, dangling symlinks and symlinked parents are rejected; there is no force-overwrite option. Creation is not an all-files transactional filesystem operation: if an I/O failure leaves a partial scaffold, inspect it before retrying; existing output is never overwritten automatically.

### Native plugin scaffold

`plugin:new <id>` creates:

```text
src/plugins/<id>/index.ts         # typed Cordis entry; fails closed until implemented
plugins/<id>/plugin.json          # schemaVersion=1, kind=native, status=scaffold
plugins/<id>/cordis.patch.yml     # independent entry, disabled:true
plugins/<id>/README.md            # migration/attribution notes
test/<id>.test.ts                # stable identity check + TODO behavioral contracts
```

The generic package exports and TypeScript include already cover new feature directories. No edit to cross-review or the root API is needed. The scaffold stays outside the aggregate bundle. Its identity test is NOT proof of migrated behavior; unresolved behavioral tests are explicitly TODO.

To complete a native plugin:

1. Implement the Host using confirmed public DSH services. Export a valid Cordis namespace (`name`, `inject`, `Config`, `apply`), not a default catalog object. Declare required services; validate actual runtime inputs, not only editor schemas.
2. Keep tools/commands/TUI on one typed service. Bind cancellation/cleanup to the native plugin lifetime; native `ctx.effect` or returned disposers own registrations and resources.
3. Add offline authorization, side-effect, isolation, failure, recovery and disposal contracts appropriate to the feature. Do not copy cross-review internals unless this plugin truly needs them.
4. Record original source URL/revision, retained license/notices, supported public API cohort and known gaps in its README. Do not label scaffolds supported or installed.
5. Keep `defaultEnabled: false` (the native descriptor default); cross-review's explicit `true` only preserves the existing bundle behavior. Change the descriptor to `status: implemented`, resolve all TODO contracts and add its flat Host row to root `cordis.patch.yml` **with `disabled: true` initially**. Keep the independent patch disabled by default for new optional functionality. Enable explicitly in a user overlay only after config and prerequisites are supplied. `implemented` describes code, not release/profile acceptance.
6. Run the checks and packed/disposable-profile gates relevant to the feature. Keep optional TUI acceptance distinct from backend acceptance.

Example aggregate addition:

```yaml
- insert:
    - id: cross-review
      name: dsh-codeasier              # keep this legacy guarded-overlay name
    - id: session-review
      name: dsh-codeasier/plugins/session-review
      disabled: true
```

A user overlay can override `session-review` with `disabled: false` and a complete `config`. Do not compose its standalone insert patch on top of this aggregate. Native `config` overlays replace wholesale; supply the entire Host configuration in the effective overlay. `plugins:check` rejects duplicate aggregate IDs, wrong entries/resources, unsafe descriptors and enabled scaffolds. It checks the repository's shipped patches, not arbitrary user overlays.

### Skill asset scaffold

`plugin:new <id> --kind skill` creates only `plugins/<id>/{plugin.json,README.md,SKILL.md}`. It registers no tool or Cordis entry. Native DSH Skill discovery/installation is a separate explicit operation; neither the descriptor nor adding this package to `profile.bundles` installs Skill files into the user's Skill directory.

Rewrite portable task instructions, resource references and DSH tool/config names; validate the frontmatter and prerequisites. Do not leave `opencode models`, `.opencode/...`, OpenCode SDK calls or a nonexistent DSH tool in supposedly DSH-ready instructions. Preserve attribution. Set `status: implemented` only after manual behavioral verification. If the Skill needs enforceable side effects, model orchestration, recovery or bounded execution, create a native scaffold instead (or under a distinct ID) and port that behavior; instructions alone cannot implement those guarantees. Related instruction assets can live alongside native plugin resources, but must not weaken native authorization.

The migrated [issue-review](../plugins/issue-review/README.md) and [issue-submit](../plugins/issue-submit/README.md) assets demonstrate evidence-only analysis and confirmed remote submission. Their task-specific resources only prepare data, never execute a forge write. DSH human questions belong to the exact live runtime root; children hand unresolved questions/drafts back to the parent. Each asset records an applicable public-testkit scripted rehearsal separately from frontmatter/collection checks. Neither that rehearsal nor repository metadata proves installation/profile support or enforceable authorization/recovery.

## OpenCode -> DSH migration checklist

| Source concern | DSH-native destination |
|---|---|
| OpenCode `PluginModule`/SDK transport | Cordis `apply` with injected public native services |
| Tool schema and handler | `defineTool`, native schema DSL, caller ownership and authoritative result |
| Slash command | Public command service; shared handler/service, not duplicated logic |
| Isolated reviewer session | Native fresh subagent; real scoped evidence/execution boundary, not cwd/prompt claims |
| Background scheduling/polling | Native events/timers plus durable state; observations never schedule |
| Permission compatibility hooks | Effective native policy/approval; denial and `never` fail closed |
| Runtime persistence | Typed native storage with explicit schema, ownership and recovery contracts |
| OpenCode UI hooks | Separate optional adapter over confirmed public TUI contracts |
| Skills/commands/agents markdown | Portable prose assets with DSH-specific tool names and explicit prerequisites |
| Existing installer | Do not copy active-profile mutation or private state access; add only after a separate verified public asset contract |

Migration should be feature-by-feature, not an OpenCode API emulation layer. Preserve license notices for any portable code/prose adapted from [open-codeasier](https://github.com/codeasier/open-codeasier). Its feature directories and separation of runtime vs workflow assets are useful precedent; its single plugin currently registers multiple tools, not independent module toggles. Here plugin enablement is independently composed by the native DSH Loader.

## Optional TUI

If needed, add `src/plugins/<id>/tui.ts` and `plugins/<id>/tui.patch.yml`; declare descriptor `tui: {entry, patch}` matching the conventions. Use row id `<id>-optional-tui`, depend on the plugin's typed service, and keep it out of the aggregate's Host-only defaults. Imports must be type-only or strictly optional public capability probes; Host imports never load TUI/React. Document missing capabilities honestly. Repository descriptors or exported patches do **not** manufacture TUI Component admission. The existing package-root Component manifest continues to cover only cross-review; another adapter will require its own confirmed ecosystem admission design, not overwriting that identity.

## Scope of support

One package with independent plugin entries is sufficient today. Split packages only when release/dependency isolation actually warrants it. Do not create an empty shared framework or a generic model-driven workflow engine. Keep new features opt-in, preserve stable IDs and versioned persisted contracts, and never run real paid reviews, publish, or install into an active profile as a side effect of migration or tests.
