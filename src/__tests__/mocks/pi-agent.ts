/**
 * Mock for @earendil-works/pi-coding-agent SDK types used by pi-verify-all.
 * Vitest will resolve `@earendil-works/pi-coding-agent` to this file via `resolve.alias`.
 */
import type { TObject } from "typebox";

// ── Re-export typebox's Type unchanged ────────────────────────
export { Type } from "typebox";

// ── UI mocks ──────────────────────────────────────────────────

export interface UIMock {
  setWidgetCalls: Array<{ name: string; lines: string[] }>;
  notifications: Array<{ message: string; type: string }>;

  setWidget(name: string, lines: string[]): void;
  notify(message: string, type: "info" | "error" | "warn"): void;
  flush(): void;
}

export function createUIMock(): UIMock {
  const ui: UIMock = {
    setWidgetCalls: [],
    notifications: [],
    setWidget(name: string, lines: string[]) {
      ui.setWidgetCalls.push({ name, lines });
    },
    notify(message: string, type: string) {
      ui.notifications.push({ message, type });
    },
    flush() {
      ui.setWidgetCalls = [];
      ui.notifications = [];
    },
  };
  return ui;
}

// ── ExtensionContext mock ─────────────────────────────────────

export interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  ui: UIMock;
}

export function createCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  const ui = overrides.ui ?? createUIMock();
  return {
    cwd: overrides.cwd ?? process.cwd(),
    hasUI: overrides.hasUI ?? true,
    ui,
  };
}

// ── ExtensionAPI mock ─────────────────────────────────────────

export interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: TObject<any>;
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate: ((update: any) => void) | undefined,
    ctx: ExtensionContext,
  ) => Promise<any>;
}

export interface RegisteredCommand {
  name: string;
  description: string;
  handler: (args: string[], ctx: ExtensionContext) => Promise<void>;
}

export type EventHandler = (event: any, ctx: ExtensionContext) => void;

export interface ExtensionAPI {
  tools: RegisteredTool[];
  commands: RegisteredCommand[];
  events: Map<string, EventHandler[]>;
  messages: string[];

  registerTool(tool: Omit<RegisteredTool, "execute"> & {
    execute: (...args: any[]) => any;
  }): void;
  registerCommand(name: string, cmd: { description: string; handler: (...args: any[]) => any }): void;
  on(event: string, handler: EventHandler): void;
  sendUserMessage(text: string): void;
}

export function createPiMock(): ExtensionAPI {
  const api: ExtensionAPI = {
    tools: [],
    commands: [],
    events: new Map(),
    messages: [],

    registerTool(tool) {
      api.tools.push(tool as RegisteredTool);
    },
    registerCommand(name, cmd) {
      api.commands.push({ name, description: cmd.description, handler: cmd.handler as any });
    },
    on(event, handler) {
      const list = api.events.get(event) ?? [];
      list.push(handler);
      api.events.set(event, list);
    },
    sendUserMessage(text) {
      api.messages.push(text);
    },
  };
  return api;
}
