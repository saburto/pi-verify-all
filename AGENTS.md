# pi-verify-all — Agent Instructions

## Project Overview

This is the `@saburto/pi-verify-all` pi package — a configurable verify pipeline extension for [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Users define steps in `.pi/verify.json` and run `/verify` to see live progress in a widget above the editor.

## Architecture

```
src/
├── index.ts        # Extension entry: registers tool, commands, auto-retry
├── pipeline.ts     # Step execution loop, result aggregation
├── widget.ts       # Builds the ANSI-styled widget lines
├── state.ts        # Shared mutable state (procs, retry count, spinner)
├── commands.ts     # Process spawning, kill handling
├── terminal.ts     # ANSI color helpers, spinner, formatting
├── types.ts        # TypeBox schemas + TypeScript types
└── __tests__/      # Vitest tests
```

- **State** (`state.ts`): singleton mutable object shared across the module. Tracks running processes, background processes, retry count, pending re-run flag, spinner index, and the widget refresh timer.
- **Pipeline** (`pipeline.ts`): runs each step sequentially. Supports conditional steps, background processes with health checks, timeouts, and `continueOnFail`. Collects results with elapsed times and error info.
- **Widget** (`widget.ts`): pure function that builds the widget lines from step info. Uses ANSI escape codes for colors (cyan, green, red, yellow, dim). Shows spinner animation when running.
- **Auto-retry**: after a failure, sets `pendingReRun = true`. On `agent_end`, if the flag is set, re-runs the pipeline automatically (up to `maxRetries` from config, default 5). Configurable via `maxRetries` field in `.pi/verify.json`.

## Widget Lifecycle

The widget is displayed via `ctx.ui.setWidget("verify-pipeline", lines)`. It uses pi's setWidget API which renders above the editor.

**Clear timing**: on success, the widget shows "✓ All checks passed" for 8 seconds then auto-clears with `setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000)`. On cancel, it clears after 3 seconds. This is intentional — the widget shouldn't stay forever after passing.

## Testing

- Tests use **Vitest**. Run with: `npm test` (alias `vitest run`)
- Always redirect test output to a temp file: `npm test > /tmp/test-output.txt 2>&1`
- Never run tests twice in the same session — read the temp file if you need results again
- Test files: `src/__tests__/extension.test.ts`, `src/__tests__/pipeline.test.ts`
- Mocks are in `src/__tests__/mocks/pi-agent.ts`

## TypeScript

- TypeCheck: `npx tsc --noEmit --project tsconfig.verify.json`
- Config uses `tsconfig.verify.json` for the verify pipeline; `tsconfig.json` is the general config

## Dependencies

- `typebox` for runtime validation of step config
- `@earendil-works/pi-coding-agent` as peer dependency (the pi SDK)
- No other runtime dependencies

## Key Patterns

- **Do not add new dependencies** without discussion. The package should stay lightweight.
- ANSI styling uses helpers from `terminal.ts`, not raw escape codes.
- The widget uses pi's `setWidget` API (placement: above editor, persistent until cleared).
- `runPipeline` accepts a callback `(lines: string[]) => void` — the caller passes `(lines) => ctx.ui.setWidget("verify-pipeline", lines)`.
