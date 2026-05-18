import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerifyConfig } from "./types.js";

// ── Config loading ────────────────────────────────────────────

/** Load verify config from `.pi/verify.json` or `verify.json` in the given directory. */
export function loadConfig(cwd: string): VerifyConfig | null {
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
