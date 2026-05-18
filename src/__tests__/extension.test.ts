/**
 * Comprehensive extension registration tests.
 * Tests command registration, tool execution, auto-retry on agent_end,
 * widget lifecycle, and error handling through the mocked pi SDK.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPiMock,
  createCtx,
  createUIMock,
  type ExtensionAPI,
  type ExtensionContext,
  type UIMock,
} from "./mocks/pi-agent.js";

// ── Load extension with a fresh piMock ─────────────────────────

async function setupExt(ui?: UIMock): Promise<{ pi: ExtensionAPI; ctx: ExtensionContext }> {
  const pi = createPiMock();
  // Dynamic import ensures vitest aliases apply
  const mod = await import("../index.js");
  mod.default(pi);

  const ctx = createCtx({
    cwd: process.cwd(),
    ui: ui ?? createUIMock(),
  });

  return { pi, ctx };
}

function getCmd(pi: ExtensionAPI, name: string) {
  return pi.commands.find((c) => c.name === name);
}

function getTool(pi: ExtensionAPI, name: string) {
  return pi.tools.find((t) => t.name === name);
}

// ── Tests ──────────────────────────────────────────────────────

describe("Extension registration", () => {
  it("registers the /verify command", async () => {
    const { pi } = await setupExt();
    expect(getCmd(pi, "verify")).toBeDefined();
    expect(getCmd(pi, "verify")!.description).toBeTruthy();
  });

  it("registers the /verify-stop command", async () => {
    const { pi } = await setupExt();
    expect(getCmd(pi, "verify-stop")).toBeDefined();
  });

  it("registers the run_verify tool", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("run_verify");
    expect(tool!.label).toBeTruthy();
    expect(tool!.description).toBeTruthy();
    expect(tool!.promptSnippet).toBeTruthy();
    expect(tool!.parameters).toBeDefined();
  });
});

describe("/verify command — non-UI mode", () => {
  it("notifies error when hasUI is false", async () => {
    const { pi } = await setupExt();
    const ctx = createCtx({ hasUI: false });
    const cmd = getCmd(pi, "verify")!;

    await cmd.handler([], ctx);

    expect(ctx.ui.notifications.some((n) => n.type === "error" && n.message.includes("interactive"))).toBe(true);
  });

  it("sends failure message when no config exists", async () => {
    const { pi } = await setupExt();

    // Use a temp dir that has NO verify config
    const { mkdirSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-noconfig-" + Date.now());
    mkdirSync(dir, { recursive: true });

    const ctx = createCtx({ hasUI: true, cwd: dir });

    try {
      const cmd = getCmd(pi, "verify")!;
      await cmd.handler([], ctx);

      // When no config exists, runPipeline returns early without setWidget.
      // The handler sends a user message about the failure instead.
      const failureMsg = pi.messages.find((m) =>
        m.includes("No .pi/verify.json") || m.includes("failed"),
      );
      expect(failureMsg).toBeDefined();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

describe("run_verify tool", () => {
  it("returns text content on success (with config)", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;

    // We need a config — create a temp dir
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-tool-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "ok", run: "true" }] }),
    );

    const ctx = createCtx({ cwd: dir });
    const abort = new AbortController();

    try {
      const result = await tool.execute("call-1", {}, abort.signal, undefined, ctx);

      // Should return content array
      expect(result.content).toBeDefined();
      const text = result.content.find((c: any) => c.type === "text");
      expect(text).toBeDefined();
      expect(text.text).toMatch(/passed|success/i);

      // Widget should have been set
      expect(ctx.ui.setWidgetCalls.some((w) => w.name === "verify-pipeline")).toBe(true);

      // After 8s, widget should be cleared (but we won't wait that long in tests)
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns error content on failure", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-tool-fail-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "fail", run: "exit 42" }] }),
    );

    const ctx = createCtx({ cwd: dir });
    const abort = new AbortController();

    try {
      const result = await tool.execute("call-2", {}, abort.signal, undefined, ctx);
      expect(result.content).toBeDefined();
      const text = result.content.find((c: any) => c.type === "text");
      expect(text).toBeDefined();
      expect(text.text).toMatch(/failed|error/i);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("requires interactive mode", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;
    const ctx = createCtx({ hasUI: false });
    const abort = new AbortController();

    const result = await tool.execute("call-3", {}, abort.signal, undefined, ctx);
    expect(result.content).toBeDefined();
    const text = result.content.find((c: any) => c.type === "text");
    expect(text.text).toMatch(/interactive/i);
  });

  it("calls onUpdate during execution", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-onupdate-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "s", run: "true" }] }),
    );

    const ctx = createCtx({ cwd: dir });
    const onUpdateCalls: any[] = [];
    const onUpdate = (update: any) => onUpdateCalls.push(update);

    try {
      await tool.execute("call-4", {}, new AbortController().signal, onUpdate, ctx);
      expect(onUpdateCalls.length).toBeGreaterThan(0);
      expect(onUpdateCalls[0].content).toBeDefined();
      expect(onUpdateCalls[0].content[0].text).toContain("Running");
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

describe("agent_end auto-retry", () => {
  it("is registered as a listener on the agent_end event", async () => {
    const { pi } = await setupExt();
    const handlers = pi.events.get("agent_end") ?? [];
    expect(handlers.length).toBe(1);
  });

  it("re-runs the pipeline when agent_end fires after a failure", async () => {
    // Note: module-level `pendingReRun` is set to true by any prior failure.
    // This test verifies the retry mechanism fires and attempts a re-run.
    const { pi } = await setupExt();

    // Create a config that will fail
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-retry-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "failagain", run: "exit 3" }] }),
    );

    const ctx = createCtx({ cwd: dir });

    // First: cause a failure to set pendingReRun = true
    const verifyCmd = getCmd(pi, "verify")!;
    await verifyCmd.handler([], ctx);
    const failMsgIdx = pi.messages.length;
    expect(pi.messages[failMsgIdx - 1]).toMatch(/failed/);

    // Now fire agent_end — it should see pendingReRun=true and retry
    const handlers = pi.events.get("agent_end") ?? [];
    await handlers[0]({}, ctx);

    // The retry should produce additional messages (either failure or retry notification)
    expect(pi.messages.length).toBeGreaterThan(failMsgIdx);

    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  });
});

describe("/verify-stop command", () => {
  it("clears pending re-run and kills processes", async () => {
    const { pi } = await setupExt();
    const cmd = getCmd(pi, "verify-stop")!;
    const ctx = createCtx();

    await cmd.handler([], ctx);

    // Should show CANCELLED widget
    const cancelled = ctx.ui.setWidgetCalls.find((w) =>
      w.lines.some((l) => l.includes("CANCELLED")),
    );
    expect(cancelled).toBeDefined();

    // Should notify
    expect(ctx.ui.notifications.some((n) => n.type === "info" && n.message.includes("stopped"))).toBe(true);
  });

  it("clears widget after 3 seconds (simulated)", async () => {
    const { pi } = await setupExt();
    const cmd = getCmd(pi, "verify-stop")!;

    // Use fake timers to fast-forward the setTimeout
    vi.useFakeTimers();
    const ctx = createCtx();
    await cmd.handler([], ctx);

    // Before 3s, there should be a widget
    const beforeClear = ctx.ui.setWidgetCalls.find((w) => w.lines.some((l) => l.includes("CANCELLED")));
    expect(beforeClear).toBeDefined();

    // Advance past 3s
    vi.advanceTimersByTime(3500);

    // The last call should be clearing the widget (empty lines)
    const lastCall = ctx.ui.setWidgetCalls.at(-1);
    // Note: setTimeout callback is registered but vitest fake timers may need awaiting
    // We'll just verify the setWidgetCalls includes a clear call
    const clearWidgetCall = ctx.ui.setWidgetCalls.find(
      (w) => w.name === "verify-pipeline" && w.lines.length === 0,
    );
    expect(clearWidgetCall).toBeDefined();

    vi.useRealTimers();
  });
});

describe("sendUserMessage on failure", () => {
  it("sends a message when /verify fails", async () => {
    const { pi } = await setupExt();
    const ctx = createCtx();

    // Create a config that will fail
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-msg-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "baddie", run: "exit 1" }] }),
    );

    const ctxWithCfg = createCtx({ cwd: dir });
    const cmd = getCmd(pi, "verify")!;

    try {
      await cmd.handler([], ctxWithCfg);

      // Should have sent a message about the failure
      const failureMsg = pi.messages.find((m) => m.includes("failed"));
      expect(failureMsg).toBeDefined();
      expect(failureMsg).toContain("baddie");
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

describe("Widget lifecycle", () => {
  it("shows RUNNING → PASSED transition on success", async () => {
    const ui = createUIMock();
    const { pi } = await setupExt(ui);
    const ctx = createCtx({ ui });

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-lifecycle-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "test-step", run: "echo done" }] }),
    );

    const ctxWithCfg = createCtx({ cwd: dir, ui });
    const cmd = getCmd(pi, "verify")!;

    try {
      await cmd.handler([], ctxWithCfg);

      // There should be multiple widget updates showing progress
      expect(ui.setWidgetCalls.length).toBeGreaterThan(1);

      // First call: initial state with RUNNING
      const first = ui.setWidgetCalls[0];
      expect(first.lines.some((l) => l.includes("RUNNING"))).toBe(true);

      // Last call before success overlay: should show PASSED
      const passedCalls = ui.setWidgetCalls.filter((w) =>
        w.lines.some((l) => l.includes("PASSED")),
      );
      expect(passedCalls.length).toBeGreaterThanOrEqual(1);

      // The success overlay sets the widget to " ✓ All checks passed"
      const okOverlay = ui.setWidgetCalls.find((w) =>
        w.lines.some((l) => l.includes("All checks passed")),
      );
      expect(okOverlay).toBeDefined();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("shows RUNNING → FAILED transition on failure", async () => {
    const ui = createUIMock();
    const { pi } = await setupExt(ui);
    const ctx = createCtx({ ui });

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-lifecycle-fail-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "bad-step", run: "echo ERROR; exit 5" }] }),
    );

    const ctxWithCfg = createCtx({ cwd: dir, ui });
    const cmd = getCmd(pi, "verify")!;

    try {
      await cmd.handler([], ctxWithCfg);

      // Should have FAILED widget
      const failedCalls = ui.setWidgetCalls.filter((w) =>
        w.lines.some((l) => l.includes("FAILED")),
      );
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);

      // Should show the error line
      const errorCalls = ui.setWidgetCalls.filter((w) =>
        w.lines.some((l) => l.includes("ERROR")),
      );
      expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

describe("TypeBox parameters", () => {
  it("tool parameters is a valid TypeBox Object schema", async () => {
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;
    expect(tool.parameters).toBeDefined();
    // TypeBox Object schemas have a type property
    expect(tool.parameters.type).toBe("object");
    // Should have empty properties (no params needed)
    expect(tool.parameters.properties).toEqual({});
  });
});

describe("Widget clearing on success", () => {
  it("clears the success overlay after 8 seconds (run_verify tool)", async () => {
    vi.useFakeTimers();
    const { pi } = await setupExt();
    const tool = getTool(pi, "run_verify")!;

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-clear-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({ steps: [{ name: "s", run: "true" }] }),
    );

    const ctx = createCtx({ cwd: dir });

    try {
      const resultPromise = tool.execute("clr-1", {}, new AbortController().signal, undefined, ctx);

      // Let any microtasks settle
      await vi.runAllTimersAsync();
      await resultPromise;

      // After 8s timeout, the widget should be cleared (empty array)
      const clearCalls = ctx.ui.setWidgetCalls.filter(
        (w) => w.name === "verify-pipeline" && w.lines.length === 0,
      );
      expect(clearCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
      vi.useRealTimers();
    }
  });
});

describe("Multiple continueOnFail steps", () => {
  it("runs all steps when all have continueOnFail", async () => {
    const { pi } = await setupExt();

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = join(tmpdir(), "pi-verify-multi-continue-" + Date.now());
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "verify.json"),
      JSON.stringify({
        steps: [
          { name: "fail1", run: "exit 10", continueOnFail: true },
          { name: "fail2", run: "exit 11", continueOnFail: true },
          { name: "good", run: "echo survived" },
        ],
      }),
    );

    const ctx = createCtx({ cwd: dir });
    const cmd = getCmd(pi, "verify")!;

    try {
      await cmd.handler([], ctx);

      const detail = ctx.ui.setWidgetCalls.filter((w) =>
        w.lines.join("\n").includes("══ Verify"),
      );
      // All three steps should appear
      const allText = detail.flatMap((w) => w.lines).join("\n");
      expect(allText).toContain("fail1");
      expect(allText).toContain("fail2");
      expect(allText).toContain("good");
      expect(allText).toContain("FAILED");
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});
