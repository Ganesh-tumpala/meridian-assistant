/**
 * Sends traces to Langfuse over OpenTelemetry.
 *
 * Langfuse accepts OTLP spans as JSON on one HTTP endpoint, so this is a plain
 * fetch rather than an SDK. You can read exactly what leaves the server, and
 * there is no background queue to go wrong when the function shuts down.
 *
 * Why OpenTelemetry and not Langfuse's own ingestion API: organisations
 * created from September 2026 onwards cannot use the older v3 endpoint. It
 * still answers 207 to every request and then quietly stores nothing, which is
 * the worst possible failure. OTLP is the supported route and, being a
 * standard, it is also what any other tracing backend would accept.
 *
 * If the keys are missing the app still works. Tracing simply turns itself
 * off, the same way a missing DATABASE_URL turns saving off.
 */

const DEFAULT_HOST = "https://cloud.langfuse.com";

export function langfuseIsConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  );
}

/**
 * Where Langfuse lives.
 *
 * Langfuse's own tools disagree on the variable name: the Python SDK reads
 * LANGFUSE_HOST and the JavaScript one reads LANGFUSE_BASE_URL. Both are
 * accepted here, because a key that is set under the other spelling looks
 * exactly like a key that was never set at all.
 */
export function langfuseHost(): string {
  const configured =
    process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASE_URL || DEFAULT_HOST;
  return configured.replace(/\/+$/, "");
}

/** The web address of one trace in the Langfuse dashboard. */
export function langfuseTraceUrl(traceId: string): string {
  return `${langfuseHost()}/trace/${traceId}`;
}

/* -------------------------------------------------------------------------
 *  Identifiers
 *
 *  OpenTelemetry is strict here: a trace id is 16 bytes and a span id is 8,
 *  both written as lower-case hex. An id in any other shape is rejected by
 *  the collector, so these are not free-form strings.
 * ----------------------------------------------------------------------- */

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newTraceId(): string {
  return randomHex(16);
}

export function newSpanId(): string {
  return randomHex(8);
}

export function isValidTraceId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

export function isValidSpanId(id: string): boolean {
  return /^[0-9a-f]{16}$/.test(id);
}

/* -------------------------------------------------------------------------
 *  What a span looks like before it becomes OTLP
 * ----------------------------------------------------------------------- */

export type TraceSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Langfuse shows a GENERATION differently: it is a call to a model. */
  kind: "SPAN" | "GENERATION";
  startTime: string;
  endTime: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  level: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
  /** Set on the root span only. These become the trace's own fields. */
  traceName?: string;
  sessionId?: string;
  userId?: string;
  tags?: string[];
};

/* -------------------------------------------------------------------------
 *  Building the OTLP payload
 * ----------------------------------------------------------------------- */

type OtelValue =
  | { stringValue: string }
  | { intValue: string }
  | { boolValue: boolean }
  | { arrayValue: { values: OtelValue[] } };

type OtelAttribute = { key: string; value: OtelValue };

function text(key: string, value: string): OtelAttribute {
  return { key, value: { stringValue: value } };
}

/** Anything that is not already a string is sent as JSON, never as [object Object]. */
function asJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function nanos(isoTime: string): string {
  const ms = Date.parse(isoTime);
  const safe = Number.isNaN(ms) ? Date.now() : ms;
  // Milliseconds to nanoseconds, in BigInt so nothing is lost to float maths.
  return (BigInt(safe) * 1_000_000n).toString();
}

/** OTel status codes: 0 unset, 1 ok, 2 error. */
function statusCode(level: TraceSpan["level"]): number {
  return level === "ERROR" ? 2 : 1;
}

export function spanAttributes(span: TraceSpan): OtelAttribute[] {
  const attributes: OtelAttribute[] = [
    // This is what tells Langfuse whether to render a span or a generation.
    text("langfuse.observation.type", span.kind === "GENERATION" ? "generation" : "span"),
    text("langfuse.observation.level", span.level),
  ];

  if (span.input !== undefined) {
    attributes.push(text("langfuse.observation.input", asJsonText(span.input)));
  }
  if (span.output !== undefined) {
    attributes.push(text("langfuse.observation.output", asJsonText(span.output)));
  }
  if (span.statusMessage) {
    attributes.push(text("langfuse.observation.status_message", span.statusMessage));
  }
  if (span.model) {
    attributes.push(text("langfuse.observation.model.name", span.model));
    attributes.push(text("gen_ai.request.model", span.model));
  }
  if (span.usage) {
    attributes.push(
      text("langfuse.observation.usage_details", asJsonText(span.usage))
    );
  }
  if (span.metadata) {
    // Flattened one key at a time. Langfuse groups these into the metadata
    // panel, where they stay searchable rather than being one opaque blob.
    for (const [key, value] of Object.entries(span.metadata)) {
      if (value === undefined) continue;
      attributes.push(text(`langfuse.observation.metadata.${key}`, asJsonText(value)));
    }
  }

  // Trace-level fields ride on the root span.
  if (span.traceName) attributes.push(text("langfuse.trace.name", span.traceName));
  if (span.sessionId) attributes.push(text("langfuse.session.id", span.sessionId));
  if (span.userId) attributes.push(text("langfuse.user.id", span.userId));
  if (span.tags && span.tags.length > 0) {
    attributes.push({
      key: "langfuse.trace.tags",
      value: { arrayValue: { values: span.tags.map((t) => ({ stringValue: t })) } },
    });
  }

  return attributes;
}

export function buildOtlpPayload(spans: TraceSpan[], serviceName = "meridian-assistant") {
  return {
    resourceSpans: [
      {
        resource: { attributes: [text("service.name", serviceName)] },
        scopeSpans: [
          {
            scope: { name: "meridian-assistant" },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: 1, // SPAN_KIND_INTERNAL
              startTimeUnixNano: nanos(span.startTime),
              endTimeUnixNano: nanos(span.endTime),
              attributes: spanAttributes(span),
              status: {
                code: statusCode(span.level),
                ...(span.statusMessage ? { message: span.statusMessage } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 *  Sending
 * ----------------------------------------------------------------------- */

export type SendOutcome = {
  sent: boolean;
  /** Why nothing was sent, when nothing was sent. */
  reason?: string;
  status?: number;
  spanCount?: number;
};

/**
 * Posts the spans and waits for the answer.
 *
 * This deliberately awaits rather than firing and forgetting. On a serverless
 * platform the function can be frozen the moment the response is returned, so
 * anything still in flight would simply vanish.
 */
export async function sendSpans(spans: TraceSpan[]): Promise<SendOutcome> {
  if (spans.length === 0) return { sent: false, reason: "nothing to send" };

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return { sent: false, reason: "LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY is not set" };
  }

  const malformed = spans.find(
    (s) => !isValidTraceId(s.traceId) || !isValidSpanId(s.spanId)
  );
  if (malformed) {
    // Worth catching here rather than at the collector, which rejects the
    // whole batch without saying which span was at fault.
    return {
      sent: false,
      reason: `span "${malformed.name}" has an id that is not valid OpenTelemetry hex`,
    };
  }

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  try {
    const response = await fetch(`${langfuseHost()}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(buildOtlpPayload(spans)),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        sent: false,
        status: response.status,
        reason: `Langfuse returned ${response.status}. ${detail.slice(0, 200)}`,
      };
    }

    return { sent: true, status: response.status, spanCount: spans.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { sent: false, reason: `could not reach Langfuse: ${message}` };
  }
}

/** Checks the credentials without writing anything, for the dashboard. */
export async function checkCredentials(): Promise<{ ok: boolean; detail: string }> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return { ok: false, detail: "Keys are not set in the environment." };
  }

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  try {
    const response = await fetch(`${langfuseHost()}/api/public/projects`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { name?: string }[] };
      const project = body?.data?.[0]?.name;
      return {
        ok: true,
        detail: project ? `Connected to the "${project}" project.` : "Keys accepted by Langfuse.",
      };
    }
    if (response.status === 401) {
      return { ok: false, detail: "Langfuse rejected the keys (401). Check for a stray space." };
    }
    return { ok: false, detail: `Langfuse returned ${response.status}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, detail: `Could not reach ${langfuseHost()}: ${message}` };
  }
}
