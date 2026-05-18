import type { StepInfo } from "./types.js";
import { state } from "./state.js";
import {
  BOLD, BOLD_OFF, DIM, RESET, GREEN, RED, YELLOW, CYAN, BLUE,
  bold, dim, green, red, yellow, cyan,
  formatDuration, SPINNER_FRAMES,
} from "./terminal.js";

// ── Widget rendering ──────────────────────────────────────────

export function buildWidgetLines(
  steps: StepInfo[],
  logLines: number,
  elapsedTotal: number,
  failed: boolean,
  success: boolean,
  errorLine: string,
  failedStepNum: number,
  logPath: string,
): string[] {
  state.spinIdx = (state.spinIdx + 1) % SPINNER_FRAMES.length;
  const sp = SPINNER_FRAMES[state.spinIdx];
  const elapsed = formatDuration(elapsedTotal);
  const lines: string[] = [];

  const titleIcon = success ? green(" ✓ ") : failed ? red(" ✗ ") : `${BLUE}${sp}${RESET} `;
  const statusLabel = success ? "PASSED" : failed ? "FAILED" : "RUNNING";
  const statusColor = success ? green : failed ? red : cyan;
  lines.push(`${cyan(bold("══ Verify"))} ${statusColor(bold(statusLabel))} ${dim("─".repeat(30))}`);

  for (const s of steps) {
    let icon: string;
    let timing: string;
    let name: string;

    if (s.status === "done") {
      icon = green(" ✓");
      timing = dim(formatDuration(s.elapsedMs).padStart(5));
      name = dim(s.name);
    } else if (s.status === "failed") {
      icon = red(" ✗");
      timing = dim(formatDuration(s.elapsedMs).padStart(5));
      name = red(s.name);
    } else if (s.status === "skipped") {
      icon = dim(" ⏭");
      timing = dim("skip");
      name = dim(s.name);
    } else if (s.status === "running") {
      icon = `${BLUE} ${sp}${RESET}`;
      timing = yellow("running");
      name = bold(s.name);
    } else {
      icon = dim(" ○");
      timing = dim("  --");
      name = dim(s.name);
    }

    const num = dim(String(s.number).padStart(2));
    lines.push(`  ${icon}  ${num}. ${name}  ${timing}`);

    if (s.status === "failed" && s.number === failedStepNum && errorLine) {
      lines.push(`      ${dim("→")} ${red(errorLine)}`);
    }
  }

  lines.push(`  ${dim("─".repeat(45))}`);

  const timeLabel = success ? "Total" : "Elapsed";
  lines.push(`  ${dim(`${timeLabel}:`)} ${bold(elapsed)}  ${dim("Logs:")} ${logPath} ${dim(`(${logLines} lines)`)}`);

  if (!success && !failed) {
    lines.push(`  ${dim("/verify-stop to cancel")}`);
  } else if (success) {
    lines.push(`  ${green("All checks passed!")}  ${dim("/verify to run again")}`);
  } else {
    lines.push(`  ${red("Fixing & re-running...")}`);
  }

  return lines;
}
