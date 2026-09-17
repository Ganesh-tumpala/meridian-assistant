/**
 * A tiny tracer.
 *
 * Every stage of the agent opens a span, does its work, and closes it. The
 * spans are collected in memory during the request and posted to Langfuse in
 * one batch at the end.
 *
 * The same spans are also returned to the page, so the run detail view shows
 * the identical timeline whether or not Langfuse is switched on.
 */

import {
  langfuseIsConfigured,
  observationEvent,
  sendBatch,
  traceEvent,
  type ObservationInput,
  type SendOutcome,
} from "@/lib/langfuse";

export type SpanRecord = {
  id: string;
  parentId?: string;
  name: string;
  type: "SPAN" | "GENERATION";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  level: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function newTraceId(): string {
  return newId("trace");
}

export type SpanOptions = {
  type?: "SPAN" | "GENERATION";
  input?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  parentId?: string;
};

export type SpanEnd = {
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
  usage?: { input?: number; output?: number; total?: number };
};

export class Tracer {
  readonly traceId: string;
  readonly name: string;
  private readonly sessionId?: string;
  private readonly userId?: string;
  private readonly spans: SpanRecord[] = [];
  private readonly pending: ObservationInput[] = [];

  constructor(options: {
    name: string;
    traceId?: string;
    sessionId?: string;
    userId?: string;
  }) {
    this.name = options.name;
    this.traceId = options.traceId ?? newTraceId();
    this.sessionId = options.sessionId;
    this.userId = options.userId;
  }

  /**
   * Runs `work` inside a span and records how long it took.
   *
   * The span is closed whether the work succeeds or throws, so a failure is
   * still visible in the trace rather than leaving a gap.
   */
  async span<T>(
    name: string,
    options: SpanOptions,
    work: (end: (info: SpanEnd) => void) => Promise<T> | T
  ): Promise<T> {
    const id = newId("obs");
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    let closing: SpanEnd = {};
    const end = (info: SpanEnd) => {
      closing = { ...closing, ...info };
    };

    try {
      const value = await work(end);
      this.close(id, name, options, closing, startedAt, startMs);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.close(
        id,
        name,
        options,
        { ...closing, level: "ERROR", statusMessage: message },
        startedAt,
        startMs
      );
      throw error;
    }
  }

  private close(
    id: string,
    name: string,
    options: SpanOptions,
    closing: SpanEnd,
    startedAt: string,
    startMs: number
  ) {
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const type = options.type ?? "SPAN";
    const level = closing.level ?? "DEFAULT";

    this.spans.push({
      id,
      parentId: options.parentId,
      name,
      type,
      startedAt,
      endedAt,
      durationMs,
      input: options.input,
      output: closing.output,
      metadata: { ...options.metadata, ...closing.metadata },
      model: options.model,
      level,
      statusMessage: closing.statusMessage,
    });

    this.pending.push({
      id,
      traceId: this.traceId,
      parentObservationId: options.parentId,
      name,
      type,
      startTime: startedAt,
      endTime: endedAt,
      input: options.input,
      output: closing.output,
      metadata: { ...options.metadata, ...closing.metadata, durationMs },
      model: options.model,
      usage: closing.usage,
      level,
      statusMessage: closing.statusMessage,
    });
  }

  /** Everything recorded so far, for the run detail page. */
  timeline(): SpanRecord[] {
    return [...this.spans];
  }

  /**
   * Posts the trace and all its spans to Langfuse in one request.
   *
   * Call this once, at the very end of the request, and await it.
   */
  async flush(summary: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }): Promise<SendOutcome> {
    if (!langfuseIsConfigured()) {
      return { sent: false, reason: "Langfuse keys are not set" };
    }

    const events = [
      traceEvent({
        id: this.traceId,
        name: this.name,
        sessionId: this.sessionId,
        userId: this.userId,
        input: summary.input,
        output: summary.output,
        metadata: summary.metadata,
        tags: summary.tags,
      }),
      ...this.pending.map(observationEvent),
    ];

    return sendBatch(events);
  }
}
