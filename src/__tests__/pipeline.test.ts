/**
 * Comprehensive pipeline integration tests.
 * Tests runPipeline indirectly through the /verify command handler with real shell commands.
 *
 * These tests create temp .pi/verify.json configs and execute shell commands
 * to verify the full pipeline lifecycle: success, failure, skip, background, health-check,
 * continueOnFail, env vars, cwd, and edge cases.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPiMock, createCtx, type UIMock } from "./mocks/pi-agent.js";

const piMock = createPiMock();

let extensionLoaded = false;
async function loadExtension(): Promise<void> {
  if (extensionLoaded) return;
  const mod = await import("../index.js");
  mod.default(piMock);
  extensionLoaded = true;
}

// ── Helpers ────────────────────────────────────────────────────

const TMP_BASE = join(tmpdir(), "pi-verify-test-" + process.pid);
let testCwd: string;

function writeVerifyConfig(steps: any[]) {
  const dir = join(testCwd, ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "verify.json"), JSON.stringify({ steps }, null, 2));
}

function getCommand(name: string) {
  return piMock.commands.find((c) => c.name === name);
}

/** Get all widget text across all updates (full pipeline detail, not just overlay) */
function allWidgetText(ui: UIMock): string {
  return ui.setWidgetCalls.flatMap((w) => w.lines).join("\n");
}

/** Get the last widget lines that contain step details (skip success/failure overlays) */
function lastDetailWidget(ui: UIMock): string[] {
  // Walk backwards to find the widget with RUNNING/PASSED/FAILED header
  for (let i = ui.setWidgetCalls.length - 1; i >= 0; i--) {
    const lines = ui.setWidgetCalls[i].lines;
    const joined = lines.join("\n");
    if (joined.includes("══ Verify") && (joined.includes("RUNNING") || joined.includes("PASSED") || joined.includes("FAILED"))) {
      return lines;
    }
  }
  return ui.setWidgetCalls.at(-1)?.lines ?? [];
}

// ── Setup / Teardown ───────────────────────────────────────────

beforeAll(() => {
  testCwd = join(TMP_BASE, "proj-" + Date.now());
  mkdirSync(testCwd, { recursive: true });
});

afterAll(() => {
  try { rmSync(TMP_BASE, { recursive: true, force: true }); } catch { /* ok */ }
});

afterEach(() => {
  const cfgDir = join(testCwd, ".pi");
  if (existsSync(cfgDir)) rmSync(cfgDir, { recursive: true, force: true });
  // Also clean root verify.json
  const rootCfg = join(testCwd, "verify.json");
  if (existsSync(rootCfg)) rmSync(rootCfg);
  piMock.messages = [];
});

// ── Tests ──────────────────────────────────────────────────────

describe("Pipeline — config loading", () => {
  it("fails with a clear message when no config exists", async () => {
    await loadExtension();
    const ctx = createCtx({ cwd: testCwd });
    const cmd = getCommand("verify");
    expect(cmd).toBeDefined();

    await cmd!.handler([], ctx);

    // runPipeline returns early without setWidget for no-config case.
    // The /verify handler sends a message instead.
    expect(piMock.messages.some((m) => m.toLowerCase().includes("failed") || m.includes("No .pi/verify.json"))).toBe(true);
  });

  it("prefers .pi/verify.json over verify.json", async () => {
    writeFileSync(join(testCwd, "verify.json"), JSON.stringify({ steps: [{ name: "root", run: "echo root" }] }));
    writeVerifyConfig([{ name: "nested", run: "echo nested" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toContain("nested");
    expect(text).not.toContain("root");
  });

  it("falls back to root verify.json when .pi/verify.json missing", async () => {
    writeFileSync(join(testCwd, "verify.json"), JSON.stringify({ steps: [{ name: "root-only", run: "echo ok" }] }));

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toContain("root-only");
  });
});

describe("Pipeline — successful runs", () => {
  it("runs a single step and reports success", async () => {
    writeVerifyConfig([{ name: "echo hello", run: "echo hello" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    // The detail widget (before success overlay) has step info
    const detail = lastDetailWidget(ctx.ui);
    const detailText = detail.join("\n");
    expect(detailText).toContain("echo hello");
    expect(detailText).toContain("PASSED");

    // The final overlay confirms success
    const overlayText = ctx.ui.setWidgetCalls.at(-1)!.lines.join("\n");
    expect(overlayText).toMatch(/All checks passed/);
  });

  it("runs multiple steps in order", async () => {
    writeVerifyConfig([
      { name: "step one", run: "echo first" },
      { name: "step two", run: "echo second" },
      { name: "step three", run: "echo third" },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toContain("step one");
    expect(text).toContain("step two");
    expect(text).toContain("step three");
    expect(text).toMatch(/All checks passed/);
  });
});

describe("Pipeline — step failures", () => {
  it("stops on first failure and reports the error", async () => {
    writeVerifyConfig([
      { name: "good step", run: "echo ok" },
      { name: "bad step", run: "exit 1" },
      { name: "never runs", run: "echo never" },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const detail = lastDetailWidget(ctx.ui);
    const text = detail.join("\n");
    expect(text).toContain("FAILED");
    expect(text).toContain("bad step");
    // "never runs" should not have a done checkmark
    expect(text).not.toMatch(/ ✓ .*never runs/);
  });

  it("continues past failed steps when continueOnFail is true", async () => {
    writeVerifyConfig([
      { name: "fail but continue", run: "exit 1", continueOnFail: true },
      { name: "should still run", run: "echo survived" },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const detail = lastDetailWidget(ctx.ui);
    const text = detail.join("\n");
    expect(text).toContain("fail but continue");
    expect(text).toContain("should still run");
    expect(text).toContain("FAILED");
  });

  it("reports signal-killed processes", async () => {
    writeVerifyConfig([{ name: "killed", run: "kill $$" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/FAILED|Killed|signal/i);
  });
});

describe("Pipeline — conditional steps", () => {
  it("skips steps whose condition returns non-zero", async () => {
    writeVerifyConfig([
      { name: "always runs", run: "echo always" },
      { name: "never runs (cond)", run: "echo nope", condition: "[ -f /no/such/file ]" },
      { name: "condition met", run: "echo yes", condition: "[ -d /tmp ]" },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toContain("always runs");
    expect(text).toContain("never runs (cond)");
    expect(text).toContain("condition met");
    expect(text).toMatch(/⏭.*never runs/);
  });
});

describe("Pipeline — background + health check", () => {
  it("starts a background process and waits for health check", async () => {
    const port = 9876 + Math.floor(Math.random() * 1000);
    writeVerifyConfig([
      {
        name: "start http server",
        run: `python3 -c "from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')
HTTPServer(('',${port}),H).serve_forever()"`,
        background: true,
        healthCheck: `http://localhost:${port}/`,
        healthTimeout: 10,
      },
      { name: "curl check", run: `curl -s http://localhost:${port}/` },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
    expect(text).toContain("start http server");
    expect(text).toContain("curl check");
  }, 20_000);

  it("fails when health check never responds", async () => {
    writeVerifyConfig([
      {
        name: "dead server",
        run: "sleep 30",
        background: true,
        healthCheck: "http://localhost:19999/nope",
        healthTimeout: 2,
      },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const detail = lastDetailWidget(ctx.ui);
    const text = detail.join("\n");
    expect(text).toContain("FAILED");
    expect(text).toMatch(/Health check failed/);
  }, 15_000);
});

describe("Pipeline — env vars and cwd", () => {
  it("passes custom env vars to the step", async () => {
    writeVerifyConfig([
      {
        name: "check env",
        run: 'test "$MY_VAR" = "hello_from_test"',
        env: { MY_VAR: "hello_from_test" },
      },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });

  it("runs steps in a custom cwd", async () => {
    const subdir = join(testCwd, "subdir");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, "marker.txt"), "present");

    writeVerifyConfig([
      {
        name: "check cwd",
        run: "test -f marker.txt",
        cwd: "subdir",
      },
    ]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });
});

describe("Pipeline — edge cases", () => {
  it("handles steps with empty env", async () => {
    writeVerifyConfig([{ name: "no env", run: "true", env: {} }]);
    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);
    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });

  it("handles steps with no/empty name but a run", async () => {
    writeVerifyConfig([{ name: "", run: "echo ok" }]);
    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);
    // Should not crash — widget calls exist
    expect(ctx.ui.setWidgetCalls.length).toBeGreaterThan(0);
  });

  it("handles output with ANSI escape codes in log", async () => {
    writeVerifyConfig([{ name: "color output", run: 'printf "\\033[32mGREEN\\033[0m\\n"' }]);
    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);
    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });

  it("handles output with tab characters", async () => {
    writeVerifyConfig([{ name: "tabbed", run: 'printf "col1\\tcol2\\n"' }]);
    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);
    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });
});

describe("Pipeline — /verify-stop", () => {
  it("cancels a running pipeline", async () => {
    writeVerifyConfig([{ name: "long runner", run: "sleep 30" }]);

    const ctx = createCtx({ cwd: testCwd });

    const verifyPromise = getCommand("verify")!.handler([], ctx);
    await new Promise((r) => setTimeout(r, 500));

    const stopCmd = getCommand("verify-stop");
    expect(stopCmd).toBeDefined();
    await stopCmd!.handler([], ctx);

    await verifyPromise;

    const cancelledWidgets = ctx.ui.setWidgetCalls.filter((w) =>
      w.lines.some((l) => l.toLowerCase().includes("cancel")),
    );
    expect(cancelledWidgets.length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

describe("Pipeline — stderr output", () => {
  it("captures stderr output in the log (success case)", async () => {
    writeVerifyConfig([{ name: "stderr test", run: "echo to-stderr >&2; true" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });

  it("detects error from stderr content", async () => {
    writeVerifyConfig([{ name: "stderr fail", run: "echo 'FAIL: something broke' >&2; exit 1" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const detail = lastDetailWidget(ctx.ui);
    const text = detail.join("\n");
    expect(text).toContain("FAILED");
    expect(text).toMatch(/something broke|FAIL/);
  });
});

describe("Pipeline — large output", () => {
  it("handles steps producing many lines", async () => {
    // Generate 100 lines of output
    writeVerifyConfig([{ name: "many lines", run: "for i in $(seq 1 100); do echo \"line $i\"; done" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    expect(text).toMatch(/All checks passed/);
  });
});

describe("Pipeline — retry count", () => {
  it("sends a message when pipeline fails (retry mechanism triggered)", async () => {
    writeVerifyConfig([{ name: "fail1", run: "echo nope; exit 2" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    // /verify handler sends a message on failure
    expect(piMock.messages.length).toBeGreaterThan(0);
    const failMsg = piMock.messages.find((m) => m.includes("fail1"));
    expect(failMsg).toBeDefined();
  });

  it("resets retry counter on a successful run after failures", async () => {
    // First: a failing run
    writeVerifyConfig([{ name: "fail", run: "exit 1" }]);
    let ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    // Then: a successful run (overwrites config)
    writeVerifyConfig([{ name: "ok", run: "true" }]);
    ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    // The success should have triggered the overlay
    const overlayText = ctx.ui.setWidgetCalls.at(-1)!.lines.join("\n");
    expect(overlayText).toMatch(/All checks passed/);
  });
});

describe("Pipeline — log file", () => {
  it("writes a log file to /tmp/verify-*", async () => {
    writeVerifyConfig([{ name: "log test", run: "echo hello-log" }]);

    const ctx = createCtx({ cwd: testCwd });
    await getCommand("verify")!.handler([], ctx);

    const text = allWidgetText(ctx.ui);
    const logLine = text.split("\n").find((l) => l.includes("/tmp/verify-"));
    expect(logLine).toBeDefined();
  });
});
