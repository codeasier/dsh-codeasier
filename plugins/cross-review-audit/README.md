# cross-review-audit

[English](README.md) | [简体中文](README.zh-CN.md) | [Documentation index](../../docs/README.md)

An independent, opt-in **DSH-native Host** audit of one explicit owned cross-review run. Implemented backend code, not a Skill-only substitute; unreleased. It depends only on native tools and the existing typed [CrossReviewService](../../src/plugins/cross-review/service.ts), never TUI/React, private run storage or session databases.

## Composition and invocation

The aggregate and [standalone patch](cordis.patch.yml) both default to `disabled: true`; the [descriptor](plugin.json) is repository metadata, not a native Component admission manifest. Use exactly one insert source. The existing [cross-review Host](../cross-review/README.md) must be mounted and configured separately; audit does not authorize or start a review. For an already composed aggregate, this is the explicit overlay shape (not an installation command):

```yaml
- id: cross-review-audit
  disabled: false
  config: {}
```

Native tool input from the exact live owning Agent:

```json
{ "runId": "00000000-0000-4000-8000-000000000001" }
```

Call `cross_review_audit`. The UUID above is only a shape example; supply an existing owned full run ID, not a prefix or a session ID. Unknown input/configuration fields are rejected. [Calling instructions](SKILL.md) are an optional portable asset and do not install themselves or register the backend. No separate slash command or TUI adapter is claimed.

## Observation contract

Only `status(agent, runId)` and `report(agent, runId)` are called. The existing service verifies exact live Agent, session/project and runtime ownership and the store validates records and evidence before returning them. Audit never lists all sessions, reads raw stores, schedules work, changes revisions, cancels/recovers/cleans runs, replays reviewers, or calls paid judges/models. Existing schema, aliases and authorization/recovery contracts remain unchanged. Disposal unregisters only the audit tool; it does not dispose cross-review.

Every check includes a stable `id`, `result`, concrete `facts`, `sources` and a scope-qualified `detail`. Output is bound to `binding: {runId, revision, snapshotId}` and separately names `reportBinding` when available. It checks:

- unique run/attempt/reviewer and exact child identities, durable controller/snapshot binding, confirmed results and exact configured provider/model routes;
- immutable snapshot hash/path/provenance validation, one-shot authorization digest/policy, effective configuration and field sources;
- revision/wall-clock observations, cancellation intent, recovery interruption/no replay, pending timeout/recovery decisions;
- strict-majority result threshold, canonical unique decisions, confirmed model-judge decisions, evidence-bound rejection/pending findings, terminal completion and derived report consistency.

`pass` verifies only the named persisted/derived fact. `anomaly` means a demonstrated contradiction. `insufficient-evidence` means a comparison or provenance is incomplete. `cannot-verify` means the available public contract cannot establish it (including unknown schema/policy versions). None is a finding-quality score or a correctness vote.

**Concurrent reads:** status and report independently observe the current record. Different revisions are `insufficient-evidence`, not an inconsistency finding; no retry/polling is initiated. Cleanup between reads leaves a bound status audit with an explicitly unverifiable report. A status ownership/store-read failure is a native tool error, with no fabricated run audit. Pure-checker malformed/unsupported fixtures exercise diagnostics separately: the real validated store may reject them before any service observation. It is never bypassed.

**Clock uncertainty:** native records use `Date.now`, not a monotonic clock. Backward timestamps or recovery of future-dated records are `insufficient-evidence`, not demonstrated lifecycle violations. Revision/history contents cannot be inferred from timestamp ordering.

**Historical gaps:** completed native children are normally released. Audit does not query registry membership or treat absence as an anomaly. Session transcripts, executed tool/request history, approval transcript and provider fees are not exposed by the two service methods; these remain `cannot-verify`. Snapshot hashes prove content integrity, not authenticity. The report contains facts from immutable evidence/results but does not dump full snapshot files or invent sessions/costs.

## Verification and delivery boundary

Pinned offline contract cohort: DSH `0.2.0-rc.2`, Cordis `4.0.4`, Node `22.22.3`, pnpm `11.21.0`. Tests exercise actual Host/tool mounting with real native services and an adapter that rejects model calls during auditing, plus genuine native child release from an explicitly scripted offline run, owner/input rejection, unavailable dependencies, disposal, repeated side-effect-free reads, pure abnormal/unknown-version fixtures, genuine durable-store rejection, and concurrent real owner controls.

```sh
pnpm run build
pnpm run test:types
pnpm run plugins:check
pnpm run test:plugins
pnpm run test:docs
node --import tsx --test test/cross-review-audit.test.ts
DSH_CODEASIER_AUDIT_PACKAGE_TEST=1 node --test test/cross-review-audit-package.test.mjs
```

The separate `test/cross-review-audit-package.test.mjs` checks a local packed artifact, export/resource identity and public native Loader activation using isolated temporary configuration and the existing dependency cohort. It is an **offline package/Loader check**, not a production dependency installation or full public CLI profile gate. `test:package` separately verifies the packed audit entry and resource resolution with production-only dependencies and no React/TUI installed; it does not activate a full CLI profile. `test:dsh-profile` and `test:tui-profile` remain separate; no audit-specific real CLI profile/TUI acceptance, active-profile installation, release or real paid review is claimed. See [the original acceptance boundaries](../../docs/contracts.md).

## Attribution and migration

Semantic scope and calling instructions adapted from [codeasier/open-codeasier at 20194ff7a7b26fd51965e50bdb5091cb37a4c0f5](https://github.com/codeasier/open-codeasier/tree/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5): [audit.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/cross-review/audit.ts), related audit-checks/project/types modules, and [SKILL.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/skills/cross-review-audit/SKILL.md). MIT, Copyright (c) 2026 codeasier; [retained license](LICENSE).

The implementation is rewritten for DSH's owner-validated service and immutable evidence. It does not copy OpenCode transport, run-store, session projection, polling counts or P0–P3 scoring. No session/message evidence is synthesized. Migration replaces explicit parent-session selection with one exact owned run UUID and preserves honest evidence/unverifiable distinctions.
