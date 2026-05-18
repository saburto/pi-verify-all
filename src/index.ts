import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

// ── Config types ──────────────────────────────────────────────

interface VerifyStep {
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

interface VerifyConfig {
  steps: VerifyStep[];
}

// ── Runtime state ─────────────────────────────────────────────

interface StepInfo {
  number: number;
  total: number;
  name: string;
  status: "pending" | "skipped" | "running" | "done" | "failed";
  elapsedMs: number;
  startedAt: number;
}

interface PipelineResult {
  success: boolean;
  errorLine: string;
  errorDetails: string;
  failedStep: string;
  logPath: string;
  steps: StepInfo[];
}

let currentProc: ChildProcess | null = null;
let backgroundProcs: ChildProcess[] = [];
let widgetTimer: ReturnType<typeof setInterval> | null = null;
let retryCount = 0;
let pendingReRun = false;
const MAX_RETRIES = 5;

// ── Config loading ────────────────────────────────────────────

function loadConfig(cwd: string): VerifyConfig | null {
  const paths = [join(cwd, ".pi", "verify.json"), join(cwd, "verify.json")];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, "utf-8");
        return JSON.parse(raw) as VerifyConfig;
      } catch {
        // ignore parse errors, handled by caller
      }
    }
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────

function expandTabs(s: string, tabWidth = 8): string {
  return s.replace(/\t/g, " ".repeat(tabWidth));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remain = secs % 60;
  return mins > 0 ? `${mins}:${String(remain).padStart(2, "0")}` : `${remain}s`;
}

function killAll(): void {
  if (widgetTimer) {
    clearInterval(widgetTimer);
    widgetTimer = null;
  }
  if (currentProc) {
    try { process.kill(-currentProc.pid!, "SIGKILL"); } catch {
      try { currentProc.kill("SIGKILL"); } catch { /* already dead */ }
    }
    currentProc = null;
  }
  for (const p of backgroundProcs) {
    try { process.kill(-p.pid!, "SIGKILL"); } catch {
      try { p.kill("SIGKILL"); } catch { /* already dead */ }
    }
  }
  backgroundProcs = [];
}

// ── Colours ────────────────────────────────────────────────────

const B = "\x1b[1m";
const b_ = "\x1b[22m";
const D = "\x1b[2m";
const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const BL = "\x1b[34m";
const X = "\x1b[0m";

function b(s: string) { return `${B}${s}${b_}`; }
function d(s: string) { return `${D}${s}${X}`; }
function g(s: string) { return `${G}${s}${X}`; }
function r(s: string) { return `${R}${s}${X}`; }
function y(s: string) { return `${Y}${s}${X}`; }
function c(s: string) { return `${C}${s}${X}`; }

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
let spinIdx = 0;

function buildWidgetLines(
  steps: StepInfo[],
  logLines: number,
  elapsedTotal: number,
  failed: boolean,
  success: boolean,
  errorLine: string,
  failedStepNum: number,
  logPath: string,
): string[] {
  spinIdx = (spinIdx + 1) % SPIN.length;
  const sp = SPIN[spinIdx];
  const elapsed = formatDuration(elapsedTotal);
  const lines: string[] = [];

  const titleIcon = success ? g(" ✓ ") : failed ? r(" ✗ ") : `${BL}${sp}${X} `;
  const state = success ? "PASSED" : failed ? "FAILED" : "RUNNING";
  const stateColor = success ? g : failed ? r : c;
  lines.push(`${c(b("══ Verify"))} ${stateColor(b(state))} ${d("─".repeat(30))}`);

  for (const s of steps) {
    let icon: string;
    let timing: string;
    let name: string;

    if (s.status === "done") {
      icon = g(" ✓");
      timing = d(formatDuration(s.elapsedMs).padStart(5));
      name = d(s.name);
    } else if (s.status === "failed") {
      icon = r(" ✗");
      timing = d(formatDuration(s.elapsedMs).padStart(5));
      name = r(s.name);
    } else if (s.status === "skipped") {
      icon = d(" ⏭");
      timing = d("skip");
      name = d(s.name);
    } else if (s.status === "running") {
      icon = `${BL} ${sp}${X}`;
      timing = y("running");
      name = b(s.name);
    } else {
      icon = d(" ○");
      timing = d("  --");
      name = d(s.name);
    }

    const num = d(String(s.number).padStart(2));
    lines.push(`  ${icon}  ${num}. ${name}  ${timing}`);

    if (s.status === "failed" && s.number === failedStepNum && errorLine) {
      lines.push(`      ${d("→")} ${r(errorLine)}`);
    }
  }

  lines.push(`  ${d("─".repeat(45))}`);

  const timeLabel = success ? "Total" : "Elapsed";
  lines.push(`  ${d(`${timeLabel}:`)} ${b(elapsed)}  ${d("Logs:")} ${logPath} ${d(`(${logLines} lines)`)}`);

  if (!success && !failed) {
    lines.push(`  ${d("/verify-stop to cancel")}`);
  } else if (success) {
    lines.push(`  ${g("All checks passed!")}  ${d("/verify to run again")}`);
  } else {
    lines.push(`  ${r("Fixing & re-running...")}`);
  }

  return lines;
}

// ── Run a single command ──────────────────────────────────────

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  logStream: string[],
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    currentProc = proc;

    const stdout = createInterface({ input: proc.stdout! });
    stdout.on("line", (raw: string) => {
      logStream.push(expandTabs(stripAnsi(raw)).trimEnd());
    });

    const stderr = createInterface({ input: proc.stderr! });
    stderr.on("line", (raw: string) => {
      const line = expandTabs(stripAnsi(raw)).trimEnd();
      if (line.length > 0) logStream.push(line);
    });

    proc.on("close", (code, signal) => {
      currentProc = null;
      resolve({ code, signal });
    });
  });
}

// ── Run a background command ──────────────────────────────────

function runBackground(
  command: string,
  cwd: string,
  env: Record<string, string>,
  logStream: string[],
): ChildProcess {
  const proc = spawn("bash", ["-c", command], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const stdout = createInterface({ input: proc.stdout! });
  stdout.on("line", (raw: string) => {
    logStream.push(expandTabs(stripAnsi(raw)).trimEnd());
  });

  const stderr = createInterface({ input: proc.stderr! });
  stderr.on("line", (raw: string) => {
    const line = expandTabs(stripAnsi(raw)).trimEnd();
    if (line.length > 0) logStream.push(line);
  });

  proc.on("close", () => {
    backgroundProcs = backgroundProcs.filter((p) => p !== proc);
  });

  backgroundProcs.push(proc);
  return proc;
}

// ── Health check polling ──────────────────────────────────────

async function waitForHealth(url: string, timeoutSec: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ── Check condition ───────────────────────────────────────────

function checkCondition(command: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: process.env as Record<string, string>,
      stdio: "ignore",
    });
    proc.on("close", (code) => resolve(code === 0));
  });
}

// ── Core pipeline runner ───────────────────────────────────────

async function runPipeline(
  cwd: string,
  setWidget: (lines: string[]) => void,
): Promise<PipelineResult> {
  killAll();

  const config = loadConfig(cwd);
  if (!config || !config.steps || config.steps.length === 0) {
    return {
      success: false,
      errorLine: "No .pi/verify.json found or no steps defined",
      errorDetails: "Create .pi/verify.json with a steps array (see pi-verify-all README).",
      failedStep: "config",
      logPath: "",
      steps: [],
    };
  }

  const steps: StepInfo[] = config.steps.map((s, i) => ({
    number: i + 1,
    total: config.steps.length,
    name: s.name,
    status: "pending" as const,
    elapsedMs: 0,
    startedAt: 0,
  }));

  const dir = mkdtempSync(join(tmpdir(), "verify-"));
  const logPath = join(dir, "pipeline.log");
  const logStream: string[] = [];
  let currentStep = 0;
  let errorLine = "";
  let errorDetails = "";
  let failed = false;
  const startTime = Date.now();

  setWidget(buildWidgetLines(steps, 0, 0, false, false, "", 0, logPath));

  widgetTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    setWidget(buildWidgetLines(steps, logStream.length, elapsed, false, false, errorLine, currentStep, logPath));
  }, 120);

  for (let i = 0; i < config.steps.length; i++) {
    const stepDef = config.steps[i];
    const stepInfo = steps[i];
    const stepCwd = stepDef.cwd ? join(cwd, stepDef.cwd) : cwd;

    // Check condition
    if (stepDef.condition) {
      const condOk = await checkCondition(stepDef.condition, stepCwd);
      if (!condOk) {
        stepInfo.status = "skipped";
        stepInfo.elapsedMs = 0;
        continue;
      }
    }

    // Start step
    stepInfo.status = "running";
    stepInfo.startedAt = Date.now();
    currentStep = stepInfo.number;

    if (stepDef.background) {
      // Background: start process, optionally wait for health check
      runBackground(stepDef.run, stepCwd, stepDef.env ?? {}, logStream);

      if (stepDef.healthCheck) {
        const healthOk = await waitForHealth(stepDef.healthCheck, stepDef.healthTimeout ?? 60);
        if (!healthOk) {
          stepInfo.status = "failed";
          stepInfo.elapsedMs = Date.now() - stepInfo.startedAt;
          errorLine = `Health check failed: ${stepDef.healthCheck}`;
          errorDetails = `Health check ${stepDef.healthCheck} did not return 200 within ${stepDef.healthTimeout ?? 60}s`;
          failed = true;
          if (!stepDef.continueOnFail) break;
        }
      }

      if (!failed) {
        stepInfo.status = "done";
        stepInfo.elapsedMs = Date.now() - stepInfo.startedAt;
      }
    } else {
      // Foreground: run and wait
      const result = await runCommand(stepDef.run, stepCwd, stepDef.env ?? {}, logStream);

      if (result.code !== 0) {
        stepInfo.status = "failed";
        stepInfo.elapsedMs = Date.now() - stepInfo.startedAt;

        // Find error line
        for (let j = logStream.length - 1; j >= 0; j--) {
          if (logStream[j].includes("FAIL:") || logStream[j].toLowerCase().includes("error")) {
            errorLine = logStream[j].trim();
            break;
          }
        }
        if (!errorLine) {
          errorLine = result.signal ? `Killed by ${result.signal}` : `Exit code ${result.code}`;
        }

        // Capture surrounding context
        const failIdx = logStream.findLastIndex(
          (l) => l.includes("FAIL:") || l.toLowerCase().includes("error"),
        );
        if (failIdx >= 0) {
          const start = Math.max(0, failIdx - 3);
          const end = Math.min(logStream.length, failIdx + 3);
          errorDetails = logStream.slice(start, end).join("\n");
        }

        failed = true;
        if (!stepDef.continueOnFail) break;
      } else {
        stepInfo.status = "done";
        stepInfo.elapsedMs = Date.now() - stepInfo.startedAt;
      }
    }
  }

  // Kill background processes
  for (const p of backgroundProcs) {
    try { process.kill(-p.pid!, "SIGKILL"); } catch {
      try { p.kill("SIGKILL"); } catch { /* already dead */ }
    }
  }
  backgroundProcs = [];

  if (widgetTimer) {
    clearInterval(widgetTimer);
    widgetTimer = null;
  }

  writeFileSync(logPath, logStream.join("\n"), "utf-8");
  const totalElapsed = Date.now() - startTime;

  if (!failed) {
    // Mark remaining pending steps as done
    for (const s of steps) {
      if (s.status === "pending") s.status = "done";
    }
    setWidget(buildWidgetLines(steps, logStream.length, totalElapsed, false, true, "", 0, logPath));
    return { success: true, errorLine: "", errorDetails: "", failedStep: "", logPath, steps };
  } else {
    const failedStepName = steps.find((s) => s.number === currentStep)?.name ?? "unknown";
    setWidget(buildWidgetLines(steps, logStream.length, totalElapsed, true, false, errorLine, currentStep, logPath));
    return { success: false, errorLine, errorDetails, failedStep: failedStepName, logPath, steps };
  }
}

// ── Extension ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── tool: run_verify ───────────────────────────────────────

  pi.registerTool({
    name: "run_verify",
    label: "Run Verify Pipeline",
    description: "Run the verify pipeline defined in .pi/verify.json and display a live status widget. Use this after fixing issues to confirm all checks pass.",
    promptSnippet: "run_verify — execute the full verify pipeline",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      if (!ctx.hasUI) {
        return { content: [{ type: "text", text: "Verify pipeline requires interactive mode." }] };
      }

      onUpdate?.({ content: [{ type: "text", text: "Running verify pipeline..." }] });

      const result = await runPipeline(ctx.cwd, (lines) => ctx.ui.setWidget("verify-pipeline", lines));

      if (result.success) {
        retryCount = 0;
        ctx.ui.setWidget("verify-pipeline", [g(b(" ✓ All checks passed"))]);
        setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
        return { content: [{ type: "text", text: "All verify checks passed!" }] };
      } else {
        retryCount++;
        pendingReRun = true;
        return {
          content: [{
            type: "text",
            text: `Verify failed at "${result.failedStep}": ${result.errorLine}\nLogs: ${result.logPath}\nFix the issue and call run_verify again.`,
          }],
        };
      }
    },
  });

  // ── auto-retry on agent_end ─────────────────────────────────

  pi.on("agent_end", async (_event, ctx) => {
    if (!pendingReRun) return;
    pendingReRun = false;

    await new Promise((r) => setTimeout(r, 500));

    const result = await runPipeline(ctx.cwd, (lines) => ctx.ui.setWidget("verify-pipeline", lines));

    if (result.success) {
      retryCount = 0;
      ctx.ui.setWidget("verify-pipeline", [g(b(" ✓ All checks passed"))]);
      setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
    } else {
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        retryCount = 0;
        pi.sendUserMessage(
          `Verify pipeline failed ${MAX_RETRIES} times — giving up.\n` +
          `Last error: ${result.errorLine}\nLogs: ${result.logPath}`,
        );
      } else {
        const attempt = retryCount > 1 ? ` (attempt ${retryCount}/${MAX_RETRIES})` : "";
        pendingReRun = true;
        pi.sendUserMessage(
          `Verify pipeline failed${attempt} at "${result.failedStep}": ${result.errorLine}\n` +
          `Logs: ${result.logPath}\nFix the issue — verify re-runs automatically.`,
        );
      }
    }
  });

  // ── /verify ─────────────────────────────────────────────────

  pi.registerCommand("verify", {
    description: "Run the verify pipeline from .pi/verify.json and show live progress",

    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/verify requires interactive mode", "error");
        return;
      }

      const result = await runPipeline(ctx.cwd, (lines) => ctx.ui.setWidget("verify-pipeline", lines));

      if (result.success) {
        retryCount = 0;
        ctx.ui.setWidget("verify-pipeline", [g(b(" ✓ All checks passed"))]);
        setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
      } else {
        retryCount++;
        pendingReRun = true;
        pi.sendUserMessage(
          `Verify pipeline failed at "${result.failedStep}": ${result.errorLine}\n` +
          `Logs: ${result.logPath}\nFix the issue — verify re-runs automatically.`,
        );
      }
    },
  });

  // ── /verify-stop ────────────────────────────────────────────

  pi.registerCommand("verify-stop", {
    description: "Cancel the running verify pipeline",
    handler: async (_args, ctx) => {
      pendingReRun = false;
      killAll();
      ctx.ui.setWidget("verify-pipeline", [r(b(" ══ Verify CANCELLED"))]);
      setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 3000);
      ctx.ui.notify("Verify pipeline stopped", "info");
    },
  });
}
