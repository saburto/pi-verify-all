// ── Config types ──────────────────────────────────────────────

export interface VerifyStep {
  name: string;
  run: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  /** Shell command that must exit 0 for the step to run. Skip if non-zero. */
  condition?: string;
  /** Don't stop the pipeline if this step fails. */
  continueOnFail?: boolean;
  /** Start as a background process (killed when pipeline ends). */
  background?: boolean;
  /** URL to poll until 200 before marking the step done. */
  healthCheck?: string;
  /** Max seconds to wait for healthCheck. Default 60. */
  healthTimeout?: number;
}

export interface VerifyConfig {
  steps: VerifyStep[];
  /** Maximum auto-retry attempts after failure. Default 5. */
  maxRetries?: number;
  /** Shell command to run when all retries are exhausted (e.g. a notification). */
  onExhausted?: string;
}

// ── Runtime state ─────────────────────────────────────────────

export interface StepInfo {
  number: number;
  total: number;
  name: string;
  status: "pending" | "skipped" | "running" | "done" | "failed";
  elapsedMs: number;
  startedAt: number;
}

export interface PipelineResult {
  success: boolean;
  errorLine: string;
  errorDetails: string;
  failedStep: string;
  logPath: string;
  steps: StepInfo[];
}
