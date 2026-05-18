import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { state } from "./state.js";
import { bold, green, red } from "./terminal.js";
import { runPipeline } from "./pipeline.js";
import { killAll } from "./commands.js";

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
        state.retryCount = 0;
        ctx.ui.setWidget("verify-pipeline", [green(bold(" ✓ All checks passed"))]);
        setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
        return { content: [{ type: "text", text: "All verify checks passed!" }] };
      } else {
        state.retryCount++;
        state.pendingReRun = true;
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
    if (!state.pendingReRun) return;
    state.pendingReRun = false;

    await new Promise((r) => setTimeout(r, 500));

    const result = await runPipeline(ctx.cwd, (lines) => ctx.ui.setWidget("verify-pipeline", lines));

    if (result.success) {
      state.retryCount = 0;
      ctx.ui.setWidget("verify-pipeline", [green(bold(" ✓ All checks passed"))]);
      setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
    } else {
      state.retryCount++;
      if (state.retryCount > state.maxRetries) {
        state.retryCount = 0;
        pi.sendUserMessage(
          `Verify pipeline failed ${state.maxRetries} times — giving up.\n` +
          `Last error: ${result.errorLine}\nLogs: ${result.logPath}`,
        );
      } else {
        const attempt = state.retryCount > 1 ? ` (attempt ${state.retryCount}/${state.maxRetries})` : "";
        state.pendingReRun = true;
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
        state.retryCount = 0;
        ctx.ui.setWidget("verify-pipeline", [green(bold(" ✓ All checks passed"))]);
        setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 8000);
      } else {
        state.retryCount++;
        state.pendingReRun = true;
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
      state.pendingReRun = false;
      killAll();
      ctx.ui.setWidget("verify-pipeline", [red(bold(" ══ Verify CANCELLED"))]);
      setTimeout(() => ctx.ui.setWidget("verify-pipeline", []), 3000);
      ctx.ui.notify("Verify pipeline stopped", "info");
    },
  });
}
