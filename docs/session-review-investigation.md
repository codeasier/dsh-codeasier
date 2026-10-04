# Session-review public-read investigation

[English](session-review-investigation.md) | [简体中文](session-review-investigation.zh-CN.md) | [Documentation index](README.md)

## Decision and scope

[Issue #11](https://github.com/codeasier/dsh-codeasier/issues/11) is an investigation, **not a session-review plugin implementation**. At DSH `0.2.0-rc.2` / Cordis `4.0.4`, a trusted Host can read one explicitly identified live or persisted-not-loaded session using the public `ctx.sessionQuery` service **when a concrete backend is mounted**. This does not grant a model permission to read that session. There is no new plugin entry, scaffold, exporter, session picker, archive, deletion or resume operation in this delivery. The existing cross-review reviewer session-query prohibition is unchanged.

Verified environment: Node `22.22.3`, pnpm `11.21.0`, repository base `52f64d752198311d4933273f0040974aab905338`. Installed dependency metadata and actual calls are checked by [the offline contracts](../test/session-query-contracts.test.mjs), named `SQ1`–`SQ18`. Results apply only to this pinned composition and fixtures, not every profile, historical format or future version.

## Exact public sources and composition

All DSH packages below are **`0.2.0-rc.2`**. The sources are published package roots/subpath exports, READMEs and declarations; source availability alone is not an execution result.

| Source key | Published interface/source | Used and verified scope |
|---|---|---|
| Q | [session-query README](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/README.md), [public declarations](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/lib/types/index.d.ts), [observation contract](https://unpkg.com/@deepseek-ai/dsh-session-query@0.2.0-rc.2/lib/types/observation.d.ts) | `readSession(id)`, `observeSession(id, options)`, `readSurface(id)`, `buildSessionEventRecords`, explicit leased cut, typed failures |
| B | [session-query-sqlite README](https://unpkg.com/@deepseek-ai/dsh-session-query-sqlite@0.2.0-rc.2/README.md) | Real concrete backend, `path: ':memory:'`; `openAt: 'never'` for exact reads, `startup` for snippet/page test only |
| S | [session public declarations](https://unpkg.com/@deepseek-ai/dsh-session@0.2.0-rc.2/lib/types/index.d.ts), [surface contract](https://unpkg.com/@deepseek-ai/dsh-session@0.2.0-rc.2/lib/types/surface.d.ts) | Session creation/appends; public `foldSurface` and `deriveEventMessage` over Q's events, not deprecated synchronous event readers |
| P | [persistence README](https://unpkg.com/@deepseek-ai/dsh-session-persistence@0.2.0-rc.2/README.md), [JSONL backend README](https://unpkg.com/@deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2/README.md) | Real isolated JSONL backend, `compression: 'none'`; public `create/append/flush/close`, `open(id, 'read')/read`, `stat`; no private DB |
| F | [format catalog message-projections public outlet](https://unpkg.com/@deepseek-ai/dsh-session-format-catalog@0.2.0-rc.2/lib/types/message-projections.js) | `currentSessionMessageProjections` supplied to the same-cut fold; only the exercised records are verified |
| L/T | [LLM message declarations](https://unpkg.com/@deepseek-ai/dsh-llm@0.2.0-rc.2/lib/types/message.d.ts), [tools README](https://unpkg.com/@deepseek-ai/dsh-tools@0.2.0-rc.2/README.md), [AgentLoop testkit](https://unpkg.com/@deepseek-ai/dsh-agent-loop-testkit@0.2.0-rc.2/README.md) | Real production loop with local `ScriptedLLM` adapter; tool rendering, failure records and public monotonic `tools.guard` |
| C | [compaction README](https://unpkg.com/@deepseek-ai/dsh-compaction@0.2.0-rc.2/README.md), [checkpoint public declarations](https://unpkg.com/@deepseek-ai/dsh-compaction@0.2.0-rc.2/lib/types/checkpoint.d.ts) | Public compaction-shaped bracket/checkpoint/replacement fixture; **not** the compaction summarizer execution |

`session-query` is an already-installed transitive public dependency owned by `@deepseek-ai/dsh`. The test follows [the repository's public resolution precedent](../test/plugin-repository.test.mjs): `createRequire(require.resolve('@deepseek-ai/dsh/package.json'))`, then resolve/import each package's public entry. DSH's bare root has no exported main; using it as the owner anchor failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, while its exported `package.json` succeeded. No private helper imports, dependency installation or shared `node_modules` changes are required. A follow-up production feature must declare its own public dependencies rather than rely on this test's transitive availability.

Exact-read topology: Cordis Context → session service → optional JSONL persistence → **concrete SQLite query backend**. The abstract query definition is not a sufficient composition by itself. Without persistence, live exact reads work but absent/cold ids return not-found. Loop tests additionally mount the public testkit prerequisites (LLM, sessions, projections, system prompt, tools, Agents) and production AgentLoop. No real provider, credentials, paid call, active profile or private user history is used.

## Observed contracts

**Verified** means the cited named test executed; **Unavailable** means the capability was absent or explicitly refused in that scenario; **Unverified** means no execution proof was obtained. Test-only grants/budget probes are deliberately not product implementations.

| Contract / result | Status and actual evidence | Exact source |
|---|---|---|
| Versions and public entry/method availability | **Verified**, SQ1 checks package metadata and exported methods at the versions above | Q/B/S/P/F/L/C |
| Explicit target, not newest/current/related-session selection | **Verified**, SQ4 test-only admission rejects undefined/empty/whitespace/padded target before any query; public methods are called with exact ids throughout. No shipped review tool exists | Q; follow-up policy probe |
| Caller identity and project/session ownership | **Verified**, SQ3 trusted service reads same-cwd peer, child and foreign-cwd session. `cwd` filtering and `parentSession` are metadata, **not authorization**; query receives no calling Agent identity | Q/S |
| Caller authorization in base query | **Unavailable**, Q/B explicitly provide no caller auth, and SQ3 actually crosses those metadata boundaries | Q/B |
| Denial without content/existence leakage | **Verified only for test policy composition**, SQ4 never queries on denial; SQ18 runs a real native monotonic tool guard: existing and absent unauthorized targets return identical `Error: SESSION_ACCESS_DENIED`, denied bodies never execute; one explicitly allowed self-target does execute. No production review-tool auth is claimed | L/T; test-only guard policy |
| Missing composition / persistence / target / empty history | **Unavailable or empty as appropriate**, SQ2: no `sessionQuery` service without backend, no persistence means cold id not-found, unknown id returns `SESSION_QUERY_SESSION_NOT_FOUND`, empty live read returns `[]`; search under `never` returns `SESSION_QUERY_SEARCH_DISABLED` | Q/B/P |
| Live preferred, detached result | **Verified**, SQ5 query includes live-only tail while public persisted handle has only prefix; modifying returned header/event does not alter later read | Q/S/P |
| Persisted-not-loaded read | **Verified**, SQ6 closes and recreates the Context over isolated JSONL store; `readSession` and `observeSession` return history, `source: 'prepared'`, revision and exact cursor without registering/attaching a Session as live or creating an Agent. Cold query can construct an unpublished prepared Session; the registry assertion proves non-attachment, not absence of object construction | Q/B/P |
| Broken optional persistence | **Verified negative fixture**, SQ7 public persistence-service subclass fails list/stat/open: cold reads return `SESSION_QUERY_PERSISTENCE_FAILED`; known live reads/observations succeed without consulting backend. Actual disk-I/O corruption remains unverified | Q/P |
| Raw log and current surface at one cut | **Verified**, SQ8 leases `observeSession(..., {projectionMode: 'none'})`, appends later data **before lazy events access**, then folds the leased events: cursor `0`, one original node/message. Independent later `readSurface` captures seq `1`; separate query calls are not an atomic pair | Q/S/F |
| Calls/results, raw arguments, successful/failed/unknown tools, reasoning | **Verified**, SQ11 real scripted production loop logs 3 calls and paired results, successful content, `FIXTURE_FAILURE`, `UNKNOWN_TOOL`, raw argument JSON, reasoning and final text; public persistence matches after explicit flush. Reasoning is in raw messages but not text-scan results | Q/S/P/L/T |
| Failed assistant attempt | **Verified**, SQ12 scripted stream yields partial text then fails with `INVALID_CREDENTIAL`; `assistant/attempt.stream` preserves that prefix and `turn/end` is error. Neither appears as an assistant surface message; one model-adapter call, no retry | Q/S/L |
| Unknown event vocabulary | **Verified**, SQ13 unknown `ignorable: true` event survives reopened cold raw read but produces no surface node or text-scan match. Canonical unknown required event (no ignorable flag) is accepted by trusted append, then reopened public storage read refuses with `SessionFormatUnsupportedError`; query maps it to `SESSION_QUERY_PERSISTENCE_FAILED`. Do not claim append performs that refusal | Q/S/P |
| Compaction and shadowed history | **Verified record semantics**, SQ10 public bracket/summary/checkpoint replaces two nodes: raw original data remains, records are shadowed/current/log-only, current surface is checkpoint + recent tail. Actual automatic/manual compaction backend execution is **Unverified** | Q/S/C |
| Fragment clipping versus message omission | **Verified native behavior**, SQ14 reads 205 messages including a >20,000-byte Unicode fragment intact; exact query imposes neither upstream review limit. Real search returns a bounded ≤32-code-point snippet and a one-item page with `nextCursor`, **not full evidence**. SQ15 **test-only** budget probe separately exercises clipping-only, omission-only and both, byte bound, stable retained ids and no input mutation; no production normalizer is delivered | Q/B/L; budget probe |
| Immutable source conflicts | **Verified**, SQ16 `listSessions` refuses conflicting live/durable cwd headers with `SESSION_QUERY_SOURCE_CONFLICT`; direct exact read still returns live. This is not an authorization failure | Q/S/P |
| Inherited versus owned evidence | **Verified**, SQ17 fork has exact inherited cut `1`, child-owned seed marker and message; persisted-not-loaded observation preserves that cut and parent id. This lineage does not grant read permission | Q/S/P |
| All profiles, historical migrations, arbitrary plugin projections, binary/attachment redaction, cancellation races, OS-atomic snapshots, actual disk corruption | **Unverified**; not inferred from declarations, format `4`, the positive fixtures or the full repository test pass | Q/S/P/F |

### Interpretation rules for a future reader

- Prefer one `observeSession` lease; record `header.id`, source, `cursor`, cold revision and `inheritedEventCount`. Fold **that same** event array with public current interpreters; use `deriveEventMessage(event, folded.projectedMessages)`. Dispose the lease. Raw logs, current node membership and projected message content are different views; `readSurface` returns current events, not a guarantee that raw event payload equals every projected model message.
- An observation is point-in-time evidence, not a subscription, lock or durable audit transaction. Cold revision is a source identifier, not a cryptographic integrity proof. Optional projection registry/cache availability and additional plugin projections require separate verification; these contracts choose `projectionMode: 'none'` and a public same-prefix fold.
- Preserve log-only calls, attempts, turn errors and unknown-type presence when troubleshooting; current surface alone loses failure evidence. Semantic filters/search intentionally omit some records (including failed attempts and reasoning), so they cannot replace raw reads. Keep original raw evidence separate from any bounded report representation.
- Cold query balances an interrupted stored tail **in memory**. SQ9 stores an open step with two assistant tool requests but only one durable call: query adds `TOOL_OUTCOME_UNKNOWN`, `TOOL_NOT_STARTED`, step/end and interrupted turn/end; public storage content/revision remain unchanged. A synthetic unknown result does **not** prove a side effect failed or authorize replay. This delivery does not resume or repair storage.
- Report provenance must distinguish persisted raw prefix and synthesized suffix. Candidate implementation can inspect public persistence `stat` / read-handle counts for an authorized cold target; no generic synthetic flag is returned by the tested query API. SQ9 proves this distinction in a controlled fixture, **not** an atomic join of independently queried storage and observation under concurrent writers. If a stable persisted cut cannot be established, mark synthetic attribution unknown rather than claiming persisted failures.
- Never treat a snippet as a complete part, current surface as the whole transcript, inherited content as child-owned, or `omittedMessages: 0` as proof of no clipped fragments. Preserve separate `partsTruncated` and `messagesOmitted` flags, byte/message bounds, retained ids and range. Selection/budget policy is future work; SQ15's small experiment does not verify an installed normalizer or a hard total-response cap.

## Fixed upstream semantic mapping and attribution

Semantic reference only: **codeasier/open-codeasier**, revision **`20194ff7a7b26fd51965e50bdb5091cb37a4c0f5`**, Copyright (c) **2026 codeasier**, [MIT license](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/LICENSE). This report retains the revision, attribution and license reference; no OpenCode SDK, transport, polling, permissions layer or upstream implementation code is copied. Original local tests remain under the [repository MIT license](../LICENSE).

| Fixed upstream resource actually inspected | Portable semantics / DSH disposition |
|---|---|
| [tool.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/tool.ts) | Exact session id; summary/troubleshoot mode; optional focus ≤2,000 characters; explicit primary-session review intent. DSH caller/execution authorization must be native and independently implemented, not copied from OpenCode context/primary check |
| [fetch.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/fetch.ts) | Nonempty session evidence and classified absence/denial/failure. Replace SDK get/messages calls with a public query lease; directory argument is not proof of permission; child listing is unnecessary for explicit single-target scope |
| [normalize.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/normalize.ts), [schema.ts](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/src/session-review/schema.ts) | Message ids/time, tool state/input/output/error, unknown markers, budget/range/count metadata. Defaults are 200 messages / 200,000 response bytes / 20,000 part bytes; summary alternates beginning/end and troubleshoot prioritizes recent messages. These limits are **not Q defaults**. Upstream top-level `truncated` tracks message omission; a clipped part alone can leave it false. Do not copy that ambiguity |
| [skills/session-review/SKILL.md](https://github.com/codeasier/open-codeasier/blob/20194ff7a7b26fd51965e50bdb5091cb37a4c0f5/skills/session-review/SKILL.md) | Facts versus inference; session/focus/range/loss disclosure; summary workflow maturity L1–L4; troubleshoot P0 unavailable evidence / P1 blocked / P2 degraded / P3 nonblocking. No inferred alternate target or internal-store search |

### Minimal summary/troubleshoot field mapping

This is a candidate follow-up contract, **not an exported schema or implemented report tool**.

| Needed field | Pinned DSH candidate and evidence | Limit / follow-up requirement |
|---|---|---|
| `sessionID`, `parentID`, project/source identity | observation `header.id`, `parentSession`, optional `cwd`, `source`, inherited cut; SQ3/SQ6/SQ17 | cwd/parent not auth; absent metadata stays unknown; primary intent/caller grant belongs outside Q |
| `mode`, `focus` | Explicit user input; upstream tool semantics | Not inferred from history; reject empty/implicit target; choose and validate focus bound |
| title | Q `readTitleSnapshot` / same-cut title fold candidate | **Unverified in this suite**; title is not on SessionHeader; independent title read may be a different cut. Omit title in minimum scope rather than invent it |
| message ids, roles, time, range | `user/message.data`, `assistant/message.data.message`, `tool/result.data.message`; event `seq/time`; SQ8/SQ11 | DSH event time is not necessarily SDK message-created time; include user source; don't silently discard system/developer evidence; derive messages from same-cut projection |
| goals, outcomes, stages/decisions, maturity | Explicit retained user/assistant text and sourced tool outcomes | Analytical conclusions with seq/message citations, not service fields; no claim about omitted/unrecorded history or actual workflow quality from tool success alone |
| summary capability candidates, automation boundaries, standardization guidance | Retained workflow stages, repeated actions and explicit decisions, cited back to messages/calls | Analytical suggestions, not native fields or proof of repeatability; distinguish L1–L4 judgment from observed outcomes |
| troubleshoot causes, tool-call quality, minimum recovery recommendation | Raw requested arguments, paired outcomes, attempts and terminal reason; SQ9/SQ11/SQ12 | Rank hypotheses separately from facts; synthetic unknown outcomes prohibit blind side-effect replay; recommend a step, never execute recovery |
| calls/input/output/error | `tool/call` name/raw arguments/callId, `tool/result.message.toolCallId/content/isError`, optional `error`/`meta`; SQ11 | Pair by call id, retain raw JSON without assuming it parsed, sanitize bounded tool-private metadata; a requested tool is not a completed action |
| stopped stage, failed/last useful action | turn/step boundaries, `turn/end.reason`, `assistant/attempt.stream`; SQ9/SQ12 | Failed attempts are not assistant surface messages. Missing usage/error fields stay unknown; preserve interruption and synthetic provenance |
| raw/current/shadowed/unknown | Q event array + S/F fold/records + C checkpoint; SQ10/SQ13 | Raw retained for evidence; label summaries/replacements, unknown event presence and unsupported records; never flatten compaction into original facts |
| total/included/omitted messages, retained ids, first/last range; fragment loss | Count explicitly defined evidence-message domain before selection; separate part/message flags; SQ14/SQ15 experiment | Events ≠ messages; choose total byte cap and deterministic summary/troubleshoot selection; metadata-too-large must fail, not silently omit safety metadata |
| unavailable diagnostic and uncertainty | service absent, not-found, persistence failed, search disabled/conflict; SQ2/SQ7/SQ13/SQ16 | Unauthorized callers receive neutral denial **before lookup**. Do not send raw persistence errors, paths, provider envelopes or secrets to the model; keep trusted troubleshooting detail separately |

## Follow-up issue proposal

**Scope:** one disabled-by-default DSH-native read-only review-input tool for one exact target and explicit user review intent, supplying bounded summary/troubleshoot evidence to an instruction asset. Start with pinned, explicitly composed Q/B plus optional current-format JSONL P; no automatic session discovery, cross-session aggregation, export generation, archive, deletion, repair/resume or paid review orchestration. No new TUI admission claim.

**Dependencies:** declare direct pinned public packages; design a trusted Host policy binding genuine caller identity + exact target + explicit intent before every lookup/content read; choose deployment scope/grant semantics independently of cwd/lineage; retain native effective tool policy and monotonic guards, with no reviewer bypass. Agree same-cut projected/raw evidence schema, secret/attachment handling, synthetic-source uncertainty and deterministic message/part/total-byte budgets. Additional profiles/history formats/projection plugins are separately gated, not silently supported.

**Acceptance:** production tool tests must repeat explicit-target validation; owner/granted access and same-cwd/parent-child/foreign denials; existence-neutral denial without backend access; absence/empty/unavailable diagnostics; live success and reopened cold success without registering/attaching the cold Session as live or creating an Agent; raw/current same cut under append; call/result/unknown/failure attempt, compaction/inherited boundaries and synthetic unknown outcomes; independent clipping/omission plus UTF-8 and hard total-byte caps; disposal/cancellation, credential redaction and unchanged cross-review restrictions. Run offline scripted adapters and bilingual docs checks; no real paid calls/profile installation. SQ4/SQ15/SQ18 are policy/budget feasibility probes only; they do not satisfy this future production tool acceptance.

**Explicit export-input candidate:** if a deployment cannot mount an authorized public query, a future tool may accept user-supplied, explicitly selected data **only after** a separately specified schema/source/cut/integrity/loss/size/secret contract. No confirmed exporter or format is promised here; no export was generated or ingested by this suite. Its authorization, freshness, provenance and completeness remain **Unverified**. Do not auto-select an exporter or fall back to private databases.

## Reproduction and validation ledger

Run against the existing pinned dependencies; installation is not part of these commands.

```sh
node --test --test-concurrency=2 test/session-query-contracts.test.mjs
node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts
pnpm run test:contracts
pnpm run test:docs
pnpm run plugins:check
pnpm run test:plugins
pnpm run build
pnpm run test:types
```

- Focused contracts: **18 passed, 0 failed, 0 skipped**. Expected Node SQLite experimental warning appears only in the real snippet/search test; it is not hidden.
- `node --import tsx --test --test-concurrency=2 test/*.test.mjs test/*.test.ts`: **144 tests, 142 passed, 0 failed, 2 skipped** (opt-in package/profile gates), exit `0`.
- `pnpm run test:contracts`: **3/3 passed**; `pnpm run test:docs`: **4/4 passed**, including this English/Chinese pair; `pnpm run test:plugins`: **13/13 passed**; all exit `0`.
- `pnpm run plugins:check`: **1 existing plugin validated**, exit `0`; `pnpm run build` and `pnpm run test:types`: **passed**, exit `0`. No plugin or package metadata was added.
- Development probes initially failed: DSH bare root is not exported; an empty supplied Session seed adds a lifecycle marker; tool output renderer takes `(args, value)`; search page field is `items`; `ignorable: false` is not the canonical required-event envelope; seeded persistence creation requires an explicit inherited count. The fixtures were corrected against the public contracts and rerun; no upstream service was patched to make tests pass.
- **Not run:** package acceptance (installs dependencies), `test:dsh-profile`, `test:tui-profile`, other DSH/Cordis versions, active-profile checks, private histories and paid models. These are outside this investigation and no passing/full-TUI claim is added.
