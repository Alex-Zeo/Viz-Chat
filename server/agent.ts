import { v4 as uuid } from 'uuid';
import { EventEncoder } from '@ag-ui/encoder';
import type { BaseEvent } from '@ag-ui/core';
import type { Request, Response } from 'express';
import type { EmitFn } from './types.js';
import { runOrchestrator, runPanelRefine } from './orchestrator.js';

/**
 * Create an emitter function that encodes AG-UI events and writes them
 * to the HTTP response as SSE frames.
 *
 * EmitFn uses `type: string` for ergonomics; we cast to BaseEvent for
 * the encoder which expects the EventType enum.
 */
export function createEmitter(encoder: EventEncoder, res: Response): EmitFn {
  return (event: { type: string; [key: string]: unknown }) => {
    const encoded = encoder.encode(event as unknown as BaseEvent);
    res.write(encoded);
  };
}

export interface ToolEmitters {
  emitToolStart: (toolCallId: string, toolName: string) => void;
  emitToolArgs: (toolCallId: string, args: Record<string, unknown>) => void;
  emitToolEnd: (toolCallId: string) => void;
  emitToolResult: (toolCallId: string, messageId: string, content: string) => void;
}

export function createToolEmitters(emit: EmitFn): ToolEmitters {
  return {
    emitToolStart(toolCallId, toolName) {
      emit({ type: 'TOOL_CALL_START', toolCallId, toolCallName: toolName });
    },
    emitToolArgs(toolCallId, args) {
      emit({ type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify(args) });
    },
    emitToolEnd(toolCallId) {
      emit({ type: 'TOOL_CALL_END', toolCallId });
    },
    emitToolResult(toolCallId, messageId, content) {
      emit({ type: 'TOOL_CALL_RESULT', toolCallId, messageId, content, role: 'tool' });
    },
  };
}

/**
 * AG-UI agent handler. Receives a POST with messages/state,
 * streams back SSE events through the 7-stage orchestrator pipeline.
 */
export async function agentHandler(req: Request, res: Response): Promise<void> {
  // 1. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 2. Create encoder (SSE mode, no protobuf)
  const encoder = new EventEncoder();

  // 3. Extract message and state from request body
  const body = req.body ?? {};
  const messages: Array<{ role: string; content?: string }> = body.messages ?? [];
  const state: Record<string, unknown> = body.state ?? {};

  // Find the user's query: last message with role "user"
  const userMessage = [...messages].reverse().find((m) => m.role === 'user');
  const query = userMessage?.content ?? 'Show me key metrics';

  // Company slug from state or default
  const companySlug = (state.company as string) ?? 'olist';

  // Thread and run IDs: use from body if provided, otherwise generate
  const threadId = (body.threadId as string) ?? uuid();
  const runId = (body.runId as string) ?? uuid();

  // 4. Create emitter
  const emit = createEmitter(encoder, res);

  // 5. Detect /panel N command for single-panel refinement
  const panelMatch = query.match(/^\/panel\s+([1-4])\s+(.*)/is);

  // 6. Emit RUN_STARTED
  emit({ type: 'RUN_STARTED', threadId, runId });

  try {
    if (panelMatch) {
      const panelIndex = parseInt(panelMatch[1], 10) - 1;
      const feedback = panelMatch[2].trim();
      console.log(`[panel-refine] Panel ${panelIndex + 1}: "${feedback}"`);
      await runPanelRefine(panelIndex, feedback, emit, threadId, runId);
    } else {
      await runOrchestrator(query, companySlug, emit, threadId, runId);
    }

    emit({ type: 'RUN_FINISHED', threadId, runId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'RUN_ERROR', message, code: 'ORCHESTRATOR_ERROR' });
  }

  // 8. End response
  res.end();
}
