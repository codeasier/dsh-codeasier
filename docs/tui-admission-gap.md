# Unresolved native TUI Component admission

[English](tui-admission-gap.md) | [简体中文](tui-admission-gap.zh-CN.md) | [Documentation index](README.md)

## Scope

Verified against Node 22.22.3, public DSH 0.2.0-rc.2, Cordis 4.0.4, Cordis Loader 1.0.5 and dsh-TUI 0.12.0. This is a limitation of the inspected installed composition, not a claim about future versions or unpublished integrations. Issue #1's full mediated TUI acceptance remains unmet. This optional limitation is not a blocker for the user's narrowed delivery scope: support the capabilities available on the pinned DSH version selected from npm `latest` for the original delivery, through native review/report/control tools and explicit TUI degradation. Moving registry tags are not a compatibility guarantee.

## Actual profile evidence

The opt-in `test:tui-profile` gate installs the locally packed backend and optional adapter into a newly created temporary HOME/profile, disables real providers and unrelated profile features, and drives the actual TUI through a PTY. It uses only the scripted `fixture-only` provider. Explicit native approval in a genuine parent turn starts two fresh, evidence-bound reviewers; both return terminal structured empty findings and their native children/controllers are disposed.

The adapter is ACTIVE (state 2), with a real non-root activation UID. The advertised Host Descriptor includes `commands.dsh/v1alpha1#Command`; the rich progress and report scene registrations are available. Nevertheless, the adapter's **own activation** publishes:

```text
command: false
Mediated review command registration was refused:
the calling activation has no verified dsh-plugin.json Component identity
```

The owning Agent's native command registry contains no `review` command. The fixture fails before sending report text, so no unknown command is forwarded to a model. PTY termination and exact-path temporary HOME cleanup complete even on this failure. A successful native review is not successful mediated TUI command/report/control acceptance.

The evidence comes from the frozen `cross-review/tui-capabilities` event emitted by the adapter itself, not a fixture borrowing another plugin's Context. Cross-plugin asynchronous probes can be rejected independently of admission. Cordis `Context.is` also supports multiple copies, so an `instanceof` mismatch is not sufficient evidence of the cause.

## Public API boundary

Published declarations and exports provide the following evidence (paths below are inside the pinned packages):

- TUI `package.json`, `exports`: no public admission, Kernel or Loader-bridge subpath; no wildcard exposing the adapter internals.
- TUI `lib/types/plugin-host.d.ts:1–14`: public mediated services, types and constants, but no admission or identity-binding export.
- TUI `lib/types/dsh-adapter/plugin-host.d.ts:65–82`: the public `TuiPluginHost` supports grants, descriptors, mediated command registration and diagnostics. It explicitly says Loader-only admission is deliberately omitted from package exports.
- The same declaration at `:164–168` states that the internal admission capability is Loader-only and that a plugin using the public service proxy receives deterministic denial.
- Cordis Loader's public `EntryOptions` offers `id`, `name`, `config`, `group`, `disabled` and `inject`; its configuration offers `baseUrl`. Its activation imports the configured module and runs the plugin, without a manifest-aware identity admission hook.
- Public DSH `runProfile`/`boot` compose these Loader entries. Their published options do not select/admit a manifested Host facet. Native package manifests describe bundle patches/profile bundles, not TUI Component identity admission.
- `@dsh-std/manifest` parses, validates and projects the static manifest; those operations do not bind an identity to a live Cordis activation.

A bounded inspection of these public surfaces found no supported native profile recipe that supplies the required host-owned admission step. Reading published implementation for provenance confirms that plugin-side self-admission is deliberately refused; it is not an available workaround.

## Required upstream integration

A supported host-owned, manifest-aware Loader/composition bridge must read the installed package's `dsh-plugin.json`, validate/negotiate its Host facet, and bind the verified identity to the actual activation **before** the optional adapter registers its command. The bridge must retain native lifecycle ownership and effective permission checks. Once provided, rerun the positive profile gate against a freshly built tarball and require report rendering, stale-revision rejection, terminal cleanup and full disposal.

No private admission accessor, identity-binding helper, host monkey-patch, self-created authorization Context or unattributed direct command fallback is added here. The positive profile gate remains failing until that public integration exists; the negative boundary tests do not substitute for it. No release, active-user-profile installation or paid model review was performed.
