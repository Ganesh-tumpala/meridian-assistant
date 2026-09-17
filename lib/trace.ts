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
  newSpanId,
  newTraceId,
  sendSpans,
  type SendOutcome,
  type TraceSpan,
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
  usage?: { input?: number; output?: number; total?: number };
};

export { newTraceId };

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
  /**
   * The span that stands for the whole run.
   *
   * OpenTelemetry has no separate idea of a "trace" to hang a name on, so one
   * root span owns the run and every stage becomes its child. Without it the
   * stages would arrive as unrelated top-level spans.
   */
  readonly rootSpanId: string;
  private readonly sessionId?: string;
  private readonly userId?: string;
  private readonly startedAt: string;
  private readonly spans: SpanRecord[] = [];

  constructor(options: {
    name: string;
    traceId?: string;
    sessionId?: string;
    userId?: string;
  }) {
    this.name = options.name;
    this.traceId = options.traceId ?? newTraceId();
    this.rootSpanId = newSpanId();
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    this.startedAt = new Date().toISOString();
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
    const id = newSpanId();
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
    this.spans.push({
      id,
      parentId: options.parentId,
      name,
      type: options.type ?? "SPAN",
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      input: options.input,
      output: closing.output,
      metadata: { ...options.metadata, ...closing.metadata },
      model: options.model,
      level: closing.level ?? "DEFAULT",
      statusMessage: closing.statusMessage,
      usage: closing.usage,
    });
  }

  /** Everything recorded so far, for the run detail page. */
  timeline(): SpanRecord[] {
    return [...this.spans];
  }

  /** The spans in the shape the Langfuse client wants, root first. */
  toTraceSpans(summary: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }): TraceSpan[] {
    const endedAt = new Date().toISOString();

    const root: TraceSpan = {
      traceId: this.traceId,
      spanId: this.rootSpanId,
      name: this.name,
      kind: "SPAN",
      startTime: this.startedAt,
      endTime: endedAt,
      input: summary.input,
      output: summary.output,
      metadata: summary.metadata,
      // An error anywhere inside should colour the whole run, or a failed run
      // looks green in the list and nobody goes to look at it.
      level: this.spans.some((s) => s.level === "ERROR") ? "ERROR" : "DEFAULT",
      traceName: this.name,
      sessionId: this.sessionId,
      userId: this.userId,
      tags: summary.tags,
    };

    const children: TraceSpan[] = this.spans.map((span) => ({
      traceId: this.traceId,
      spanId: span.id,
      parentSpanId: span.parentId ?? this.rootSpanId,
      name: span.name,
      kind: span.type,
      startTime: span.startedAt,
      endTime: span.endedAt,
      input: span.input,
      output: span.output,
      metadata: { ...span.metadata, durationMs: span.durationMs },
      model: span.model,
      usage: span.usage,
      level: span.level,
      statusMessage: span.statusMessage,
    }));

    return [root, ...children];
  }

  /**
   * Posts the whole trace in one request.
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
    return sendSpans(this.toTraceSpans(summary));
  }
}
