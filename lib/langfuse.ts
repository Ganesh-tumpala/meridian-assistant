/**
 * Sends traces to Langfuse.
 *
 * Langfuse accepts a batch of events on one HTTP endpoint, so this is a plain
 * fetch rather than an SDK. You can read exactly what leaves the server, and
 * there is no background queue to go wrong when the function shuts down.
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

export function langfuseHost(): string {
  return (process.env.LANGFUSE_HOST || DEFAULT_HOST).replace(/\/+$/, "");
}

/** The web address of one trace in the Langfuse dashboard. */
export function langfuseTraceUrl(traceId: string): string {
  return `${langfuseHost()}/trace/${traceId}`;
}

/* -------------------------------------------------------------------------
 *  The event shapes Langfuse expects
 * ----------------------------------------------------------------------- */

type IngestionEvent = {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
};

export type TraceInput = {
  id: string;
  name: string;
  userId?: string;
  sessionId?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

export type ObservationInput = {
  id: string;
  traceId: string;
  parentObservationId?: string;
  name: string;
  /** "SPAN" for ordinary work, "GENERATION" for a call to a model. */
  type: "SPAN" | "GENERATION";
  startTime: string;
  endTime: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  level?: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
};

/* -------------------------------------------------------------------------
 *  Building and sending a batch
 * ----------------------------------------------------------------------- */

function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function traceEvent(trace: TraceInput): IngestionEvent {
  return {
    id: newEventId(),
    type: "trace-create",
    timestamp: new Date().toISOString(),
    body: { ...trace },
  };
}

export function observationEvent(obs: ObservationInput): IngestionEvent {
  const { type, ...rest } = obs;
  return {
    id: newEventId(),
    type: type === "GENERATION" ? "generation-create" : "span-create",
    timestamp: new Date().toISOString(),
    body: { ...rest },
  };
}

export type SendOutcome = {
  sent: boolean;
  /** Why nothing was sent, when nothing was sent. */
  reason?: string;
  status?: number;
};

/**
 * Posts a batch of events and waits for the answer.
 *
 * This deliberately awaits rather than firing and forgetting. On a serverless
 * platform the function can be frozen the moment the response is returned, so
 * anything still in flight would simply vanish.
 */
export async function sendBatch(events: IngestionEvent[]): Promise<SendOutcome> {
  if (events.length === 0) return { sent: false, reason: "nothing to send" };

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return { sent: false, reason: "LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY is not set" };
  }

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  try {
    const response = await fetch(`${langfuseHost()}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ batch: events }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        sent: false,
        status: response.status,
        reason: `Langfuse returned ${response.status}. ${detail.slice(0, 200)}`,
      };
    }

    return { sent: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { sent: false, reason: `could not reach Langfuse: ${message}` };
  }
}

/** Checks the credentials without writing anything, for the settings page. */
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
    if (response.ok) return { ok: true, detail: "Keys accepted by Langfuse." };
    if (response.status === 401) {
      return { ok: false, detail: "Langfuse rejected the keys (401). Check for a stray space." };
    }
    return { ok: false, detail: `Langfuse returned ${response.status}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, detail: `Could not reach ${langfuseHost()}: ${message}` };
  }
}
