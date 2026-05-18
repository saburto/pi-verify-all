import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { state } from "./state.js";
import { expandTabs, stripAnsi } from "./terminal.js";

// ── Run a foreground command ──────────────────────────────────

export function runCommand(
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
    state.currentProc = proc;

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
      state.currentProc = null;
      resolve({ code, signal });
    });
  });
}

// ── Run a background command ──────────────────────────────────

export function runBackground(
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
    state.backgroundProcs = state.backgroundProcs.filter((p) => p !== proc);
  });

  state.backgroundProcs.push(proc);
  return proc;
}

// ── Health check polling ──────────────────────────────────────

export async function waitForHealth(url: string, timeoutSec: number): Promise<boolean> {
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

// ── Condition check ───────────────────────────────────────────

export function checkCondition(command: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: process.env as Record<string, string>,
      stdio: "ignore",
    });
    proc.on("close", (code) => resolve(code === 0));
  });
}

// ── Kill all running processes ────────────────────────────────

export function killAll(): void {
  if (state.widgetTimer) {
    clearInterval(state.widgetTimer);
    state.widgetTimer = null;
  }
  if (state.currentProc) {
    try { process.kill(-state.currentProc.pid!, "SIGKILL"); } catch {
      try { state.currentProc.kill("SIGKILL"); } catch { /* already dead */ }
    }
    state.currentProc = null;
  }
  for (const p of state.backgroundProcs) {
    try { process.kill(-p.pid!, "SIGKILL"); } catch {
      try { p.kill("SIGKILL"); } catch { /* already dead */ }
    }
  }
  state.backgroundProcs = [];
}
