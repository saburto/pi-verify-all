import type { ChildProcess } from "node:child_process";

// ── Shared mutable state ──────────────────────────────────────

export const state = {
  /** Currently running foreground process (or null). */
  currentProc: null as ChildProcess | null,

  /** Background processes that are killed when the pipeline ends. */
  backgroundProcs: [] as ChildProcess[],

  /** Interval timer for refreshing the live widget. */
  widgetTimer: null as ReturnType<typeof setInterval> | null,

  /** How many times the pipeline has been retried after failure. */
  retryCount: 0,

  /** True when the pipeline failed and should auto-retry on agent_end. */
  pendingReRun: false,

  /** Current spinner frame index. */
  spinIdx: 0,

  /** Max auto-retry attempts (from config, default 5). */
  maxRetries: 5,

  /** Command to run when retries are exhausted (from config). */
  onExhausted: null as string | null,
};
