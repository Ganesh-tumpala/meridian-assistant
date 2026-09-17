/**
 * Checks what actually gets sent to Langfuse.
 *
 * The network is replaced with a fake, so these run without keys and without
 * writing anything to a real project. What they pin down is the shape of the
 * OTLP payload, because a collector rejects a malformed batch wholesale and a
 * wrong attribute name is accepted and then simply never displayed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendSpans,
  buildOtlpPayload,
  spanAttributes,
  langfuseHost,
  langfuseTraceUrl,
  newTraceId,
  newSpanId,
  isValidTraceId,
  isValidSpanId,
  type TraceSpan,
} from "../lib/langfuse";
import { Tracer } from "../lib/trace";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  delete process.env.LANGFUSE_HOST;
  delete process.env.LANGFUSE_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_HOST;
  delete process.env.LANGFUSE_BASE_URL;
});

function fakeOk() {
  const spy = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "{}",
    json: async () => ({}),
  }) as unknown as Response);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function aSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    name: "router",
    kind: "SPAN",
    startTime: "2026-09-17T12:00:00.000Z",
    endTime: "2026-09-17T12:00:01.000Z",
    level: "DEFAULT",
    ...overrides,
  };
}

/** Pulls one attribute's string value out of an OTLP span. */
function attr(span: { attributes: { key: string; value: Record<string, unknown> }[] }, key: string) {
  return span.attributes.find((a) => a.key === key)?.value as
    | { stringValue?: string; arrayValue?: { values: { stringValue: string }[] } }
    | undefined;
}

describe("the host", () => {
  it("defaults to Langfuse cloud", () => {
    expect(langfuseHost()).toBe("https://cloud.langfuse.com");
  });

  it("accepts LANGFUSE_HOST, as the Python SDK spells it", () => {
    process.env.LANGFUSE_HOST = "https://one.example.com";
    expect(langfuseHost()).toBe("https://one.example.com");
  });

  it("accepts LANGFUSE_BASE_URL, as the JavaScript SDK spells it", () => {
    process.env.LANGFUSE_BASE_URL = "https://two.example.com";
    expect(langfuseHost()).toBe("https://two.example.com");
  });

  it("strips a trailing slash, or every URL would double up", () => {
    process.env.LANGFUSE_HOST = "https://three.example.com/";
    expect(langfuseHost()).toBe("https://three.example.com");
  });

  it("builds a dashboard link for a trace", () => {
    expect(langfuseTraceUrl("abc123")).toBe("https://cloud.langfuse.com/trace/abc123");
  });
});

describe("identifiers", () => {
  it("makes a 32 character hex trace id", () => {
    const id = newTraceId();
    expect(id).toHaveLength(32);
    expect(isValidTraceId(id)).toBe(true);
  });

  it("makes a 16 character hex span id", () => {
    const id = newSpanId();
    expect(id).toHaveLength(16);
    expect(isValidSpanId(id)).toBe(true);
  });

  it("rejects an id that is not OpenTelemetry hex", () => {
    // The old scheme looked like this, and the collector refuses it.
    expect(isValidTraceId("trace_mu5u8z23sszyek5y")).toBe(false);
    expect(isValidSpanId("obs_abc")).toBe(false);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTraceId()));
    expect(ids.size).toBe(200);
  });
});

describe("span attributes", () => {
  it("marks a model call as a generation and other work as a span", () => {
    const generation = spanAttributes(aSpan({ kind: "GENERATION" }));
    expect(generation.find((a) => a.key === "langfuse.observation.type")?.value).toEqual({
      stringValue: "generation",
    });

    const plain = spanAttributes(aSpan({ kind: "SPAN" }));
    expect(plain.find((a) => a.key === "langfuse.observation.type")?.value).toEqual({
      stringValue: "span",
    });
  });

  it("sends objects as JSON rather than [object Object]", () => {
    const attributes = spanAttributes(aSpan({ input: { question: "hi" } }));
    const value = attributes.find((a) => a.key === "langfuse.observation.input")?.value as {
      stringValue: string;
    };
    expect(value.stringValue).toBe('{"question":"hi"}');
    expect(value.stringValue).not.toContain("[object Object]");
  });

  it("leaves a string input alone instead of quoting it twice", () => {
    const attributes = spanAttributes(aSpan({ input: "plain question" }));
    const value = attributes.find((a) => a.key === "langfuse.observation.input")?.value as {
      stringValue: string;
    };
    expect(value.stringValue).toBe("plain question");
  });

  it("flattens metadata so each key stays searchable", () => {
    const attributes = spanAttributes(aSpan({ metadata: { tool: "lookup_fee", ms: 12 } }));
    const keys = attributes.map((a) => a.key);
    expect(keys).toContain("langfuse.observation.metadata.tool");
    expect(keys).toContain("langfuse.observation.metadata.ms");
  });

  it("records the model under both names Langfuse looks for", () => {
    const keys = spanAttributes(aSpan({ model: "openai/gpt-oss-120b" })).map((a) => a.key);
    expect(keys).toContain("langfuse.observation.model.name");
    expect(keys).toContain("gen_ai.request.model");
  });

  it("puts trace level fields on the span that carries them", () => {
    const attributes = spanAttributes(
      aSpan({ traceName: "meridian-assistant", sessionId: "s1", userId: "IMAM", tags: ["knowledge", "ok"] })
    );
    const keys = attributes.map((a) => a.key);
    expect(keys).toContain("langfuse.trace.name");
    expect(keys).toContain("langfuse.session.id");
    expect(keys).toContain("langfuse.user.id");

    const tags = attributes.find((a) => a.key === "langfuse.trace.tags")?.value as {
      arrayValue: { values: { stringValue: string }[] };
    };
    expect(tags.arrayValue.values.map((v) => v.stringValue)).toEqual(["knowledge", "ok"]);
  });
});

describe("the OTLP payload", () => {
  it("nests spans the way a collector expects", () => {
    const payload = buildOtlpPayload([aSpan()]);
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes[0].key).toBe("service.name");
  });

  it("converts timestamps to nanoseconds", () => {
    const span = buildOtlpPayload([aSpan()]).resourceSpans[0].scopeSpans[0].spans[0];
    // 2026-09-17T12:00:00Z in ms, times a million.
    expect(span.startTimeUnixNano).toBe(
      (BigInt(Date.parse("2026-09-17T12:00:00.000Z")) * 1_000_000n).toString()
    );
    expect(span.startTimeUnixNano).not.toContain("e+");
  });

  it("marks a failed span with the error status code", () => {
    const span = buildOtlpPayload([
      aSpan({ level: "ERROR", statusMessage: "boom" }),
    ]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe("boom");
  });

  it("marks a healthy span as ok", () => {
    const span = buildOtlpPayload([aSpan()]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status.code).toBe(1);
  });

  it("omits parentSpanId on a root span rather than sending an empty one", () => {
    const span = buildOtlpPayload([aSpan()]).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span).not.toHaveProperty("parentSpanId");
  });
});

describe("sendSpans", () => {
  it("posts OTLP JSON to the otel endpoint with basic auth", async () => {
    const spy = fakeOk();
    const outcome = await sendSpans([aSpan()]);

    expect(outcome.sent).toBe(true);
    expect(outcome.spanCount).toBe(1);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const expected = Buffer.from("pk-lf-test:sk-lf-test").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);

    const body = JSON.parse(init.body as string);
    expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("router");
  });

  it("refuses a span whose id is not valid hex, naming the culprit", async () => {
    const spy = fakeOk();
    const outcome = await sendSpans([aSpan({ name: "bad-one", spanId: "not-hex" })]);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain("bad-one");
    // Nothing is sent, because the collector would reject the whole batch.
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends nothing when the keys are missing", async () => {
    delete process.env.LANGFUSE_SECRET_KEY;
    const spy = fakeOk();
    expect((await sendSpans([aSpan()])).sent).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends nothing when there is nothing to send", async () => {
    const spy = fakeOk();
    expect((await sendSpans([])).sent).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a rejection rather than throwing", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => '{"message":"unauthorized"}',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const outcome = await sendSpans([aSpan()]);
    expect(outcome.sent).toBe(false);
    expect(outcome.status).toBe(401);
    expect(outcome.reason).toContain("401");
  });

  it("reports an unreachable host rather than throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    const outcome = await sendSpans([aSpan()]);
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/could not reach/i);
  });
});

describe("a whole trace", () => {
  it("sends one root span plus every stage, all sharing a trace id", async () => {
    const spy = fakeOk();
    const tracer = new Tracer({ name: "meridian-assistant", sessionId: "s1", userId: "IMAM" });

    await tracer.span("router", { type: "SPAN" }, () => null);
    await tracer.span("planner", { type: "GENERATION" }, () => null);
    await tracer.span("tool:lookup_fee", { type: "SPAN" }, () => null);

    const outcome = await tracer.flush({ input: "q", output: "a", tags: ["knowledge"] });
    expect(outcome.sent).toBe(true);

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const spans = JSON.parse(init.body as string).resourceSpans[0].scopeSpans[0].spans;

    // Root plus three stages.
    expect(spans).toHaveLength(4);
    for (const span of spans) {
      expect(span.traceId).toBe(tracer.traceId);
    }

    // Every stage hangs off the root, or they arrive as unrelated traces.
    const root = spans[0];
    expect(root.name).toBe("meridian-assistant");
    expect(attr(root, "langfuse.trace.name")?.stringValue).toBe("meridian-assistant");
    expect(attr(root, "langfuse.session.id")?.stringValue).toBe("s1");
    for (const child of spans.slice(1)) {
      expect(child.parentSpanId).toBe(tracer.rootSpanId);
    }
  });

  it("colours the whole run as an error when any stage failed", async () => {
    const spy = fakeOk();
    const tracer = new Tracer({ name: "test" });

    await expect(
      tracer.span("boom", {}, () => {
        throw new Error("failed");
      })
    ).rejects.toThrow();

    await tracer.flush({ input: "q", output: "a" });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const spans = JSON.parse(init.body as string).resourceSpans[0].scopeSpans[0].spans;

    // A green run nobody looks at is worse than a red one.
    expect(spans[0].status.code).toBe(2);
    expect(spans[1].status.message).toBe("failed");
  });

  it("uses a valid OpenTelemetry trace id out of the box", () => {
    const tracer = new Tracer({ name: "test" });
    expect(isValidTraceId(tracer.traceId)).toBe(true);
    expect(isValidSpanId(tracer.rootSpanId)).toBe(true);
  });

  it("does not try to send anything when Langfuse is not configured", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    const tracer = new Tracer({ name: "test" });
    await tracer.span("step", {}, () => null);
    const outcome = await tracer.flush({ input: "q", output: "a" });
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/not set/i);
  });
});
