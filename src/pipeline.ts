import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VerifyConfig, StepInfo, PipelineResult } from "./types.js";
import { state } from "./state.js";
import { loadConfig } from "./config.js";
import { bold, dim, green, red, formatDuration } from "./terminal.js";
import { buildWidgetLines } from "./widget.js";
import { runCommand, runBackground, waitForHealth, checkCondition, killAll } from "./commands.js";

// ── Core pipeline runner ───────────────────────────────────────

export async function runPipeline(
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

  state.widgetTimer = setInterval(() => {
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
  killAll();

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
