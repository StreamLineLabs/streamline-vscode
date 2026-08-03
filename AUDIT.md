# Clean Code and SRP Audit

## Summary

- **Highest-leverage split:** reduce `activate()`/`extension.ts` to composition
  and move feature command registration into topic, consumer-group, schema,
  connection, branch, and memory registrars.
- The extension module changes for product features owned by different users
  and APIs, while sharing only VS Code context and current client selection.
- Existing tests prove command names are registered but do not characterize
  most callback effects, prompts, error messages, or refresh ordering.
- Tree providers are already separated by actor and should not be merged behind
  a generic tree abstraction.
- Baseline dead-code/type/test-harness fixes are complete; structural movement
  is deferred until command behavior is pinned.

## Findings

| ID | Location | Category | Severity | Actors in conflict | Cost | Size | Behavior risk |
|---|---|---|---|---|---|---|---|
| VSCODE-SRP-1 | `src/extension.ts` | SRP, activation god module | P1 | connection UX; topic admin; consumer ops; schema governance; topology/observability; Moonshot branches/memory | Any feature adds commands, prompts, client calls, refreshes, and error copy to the same activation function. | L | High |
| VSCODE-CC-1 | `src/extension.ts` command callbacks | Mixed abstraction | P2 | VS Code presentation; HTTP client contract | Registration, input validation, transport calls, formatting, and user notifications are interleaved in large callbacks. | L | High |
| VSCODE-CC-2 | tree/provider files | Repeated error/display patterns | P2 | separate feature actors | Similar `any` response narrowing and error UI exist, but a generic base provider would couple unrelated API evolution. | M | Medium |

## Actor Partition

Resulting units after characterization:

- `registerConnectionCommands`
- `registerTopicCommands`
- `registerConsumerGroupCommands`
- `registerSchemaCommands`
- `registerObservabilityCommands`
- `registerBranchCommands`
- `registerMemoryCommands`

Each registrar owns a coherent public command group and accepts the explicit
clients/providers it needs. `activate()` retains construction, dependency
wiring, view registration, subscriptions, and disposal.

## Ordered Refactor Sequence

1. Add tests for command callback success, cancellation, invalid input,
   transport failure, user-facing errors, and provider refresh.
2. Move one command group unchanged per commit, starting with read-only branch
   and memory commands.
3. Run compile, lint, Electron tests, and package build after each move.
4. Extract validation/formatting helpers only after multiple callbacks share
   the same actor and change together.

## Deferred

- Command registrar extraction is deferred: current tests assert registration
  but not enough behavior to preserve prompts, errors, and refresh side effects.
- Remaining explicit-`any` warnings require API response models, not blanket
  casts or lint suppression.
- HTTP route migration requires the org API contract decision.

## Out of Scope

- Individual tree providers: already actor-aligned.
- `messageViewer.ts`: one webview presentation actor.
- `client.ts`: one HTTP transport contract.
- Syntax grammar and package contribution declarations: public extension
  contract artifacts.
