/**
 * Patched type declarations for dogfood verify.
 * Re-exports everything from the real SDK but relaxes registerTool signature
 * so the extension works without 'details' in AgentToolResult.
 */
import type * as Real from "../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";

// Re-export everything unchanged
export * from "../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";

import type { Theme, ToolRenderResultOptions } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";

// ── Relaxed types (details is optional) ──────────────────────

type RelaxedToolResult = {
  content: { type: string; text: string }[];
  details?: unknown;
  terminate?: boolean;
};

type RelaxedUpdateCallback = (partialResult: RelaxedToolResult) => void;

type RelaxedExecute = (
  toolCallId: string,
  params: any,
  signal: AbortSignal | undefined,
  onUpdate: RelaxedUpdateCallback | undefined,
  ctx: Real.ExtensionContext,
) => Promise<RelaxedToolResult>;

// ── Patch ExtensionAPI ────────────────────────────────────────

export interface ExtensionAPI extends Omit<Real.ExtensionAPI, "registerTool"> {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    parameters: any;
    execute: RelaxedExecute;
    renderResult?: (result: any, options: ToolRenderResultOptions, theme: Theme, context: any) => any;
  }): void;
}
