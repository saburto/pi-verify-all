// ── Terminal output formatting ────────────────────────────────

/** Expand tab characters to spaces. */
export function expandTabs(s: string, tabWidth = 8): string {
  return s.replace(/\t/g, " ".repeat(tabWidth));
}

/** Strip ANSI escape codes from a string. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Format milliseconds as a human-readable duration string. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remain = secs % 60;
  return mins > 0 ? `${mins}:${String(remain).padStart(2, "0")}` : `${remain}s`;
}

// ── ANSI escape codes ─────────────────────────────────────────

export const BOLD = "\x1b[1m";
export const BOLD_OFF = "\x1b[22m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const BLUE = "\x1b[34m";

// ── Styled text helpers ───────────────────────────────────────

export function bold(s: string) { return `${BOLD}${s}${BOLD_OFF}`; }
export function dim(s: string) { return `${DIM}${s}${RESET}`; }
export function green(s: string) { return `${GREEN}${s}${RESET}`; }
export function red(s: string) { return `${RED}${s}${RESET}`; }
export function yellow(s: string) { return `${YELLOW}${s}${RESET}`; }
export function cyan(s: string) { return `${CYAN}${s}${RESET}`; }

// ── Spinner ───────────────────────────────────────────────────

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
