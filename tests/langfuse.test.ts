/**
 * Checks what actually gets sent to Langfuse.
 *
 * The network is replaced with a fake, so these run without keys and without
 * writing anything to a real project. What they pin down is the shape of the
 * request, because a malformed batch is accepted with a 207 and then silently
 * dropped, which is the hardest kind of failure to notice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendBatch, traceEvent, observationEvent, langfuseHost } from "../lib/langfuse";
import { Tracer } from "../lib/trace";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  delete process.env.LANGFUSE_HOST;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_HOST;
});

function fakeOk() {
  const spy = vi.fn(async () => ({
    ok: true,
    status: 207,
    text: async () => "{}",
    json: async () => ({}),
  }) as unknown as Response);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("the host", () => {
  it("defaults to Langfuse cloud", () => {
    expect(langfuseHost()).toBe("https://cloud.langfuse.com");
  });

  it("uses a self-hosted address when one is given", () => {
    process.env.LANGFUSE_HOST = "https://langfuse.example.com/";
    // The trailing slash is stripped, or every URL would contain a double slash.
    expect(langfuseHost()).toBe("https://langfuse.example.com");
  });
});

describe("event shapes", () => {
  it("builds a trace-create event", () => {
    const event = traceEvent({ id: "t1", name: "run", input: "hello" });
    expect(event.type).toBe("trace-create");
    expect(event.body.id).toBe("t1");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("calls a model step a generation, not a span", () => {
    const event = observationEvent({
      id: "o1",
      traceId: "t1",
      name: "planner",
      type: "GENERATION",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    });
    expect(event.type).toBe("generation-create");
    // "type" is what selects the event kind; it must not also be sent in the
    // body, where Langfuse would reject it as an unknown field.
    expect(event.body).not.toHaveProperty("type");
  });

  it("calls ordinary work a span", () => {
    const event = observationEvent({
      id: "o2",
      traceId: "t1",
      name: "tool",
      type: "SPAN",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    });
    expect(event.type).toBe("span-create");
  });
});

describe("sendBatch", () => {
  it("posts to the ingestion endpoint with basic auth", async () => {
    const spy = fakeOk();
    const outcome = await sendBatch([traceEvent({ id: "t1", name: "run" })]);

    expect(outcome.sent).toBe(true);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cloud.langfuse.com/api/public/ingestion");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const expected = Buffer.from("pk-lf-test:sk-lf-test").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);

    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.batch)).toBe(true);
    expect(body.batch[0].id).toBeTruthy();
  });

  it("sends nothing when the keys are missing", async () => {
    delete process.env.LANGFUSE_SECRET_KEY;
    const spy = fakeOk();
    const outcome = await sendBatch([traceEvent({ id: "t1", name: "run" })]);

    expect(outcome.sent).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends nothing when there is nothing to send", async () => {
    const spy = fakeOk();
    expect((await sendBatch([])).sent).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a rejection rather than throwing", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => '{"message":"unauthorized"}',
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const outcome = await sendBatch([traceEvent({ id: "t1", name: "run" })]);
    expect(outcome.sent).toBe(false);
    expect(outcome.status).toBe(401);
    expect(outcome.reason).toContain("401");
  });

  it("reports an unreachable host rather than throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    const outcome = await sendBatch([traceEvent({ id: "t1", name: "run" })]);
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/could not reach/i);
  });
});

describe("a whole trace", () => {
  it("sends the trace and every span in one batch", async () => {
    const spy = fakeOk();
    const tracer = new Tracer({ name: "meridian-assistant", sessionId: "s1", userId: "IMAM" });

    await tracer.span("router", { type: "SPAN" }, () => null);
    await tracer.span("planner", { type: "GENERATION" }, () => null);
    await tracer.span("tool:lookup_fee", { type: "SPAN" }, () => null);

    const outcome = await tracer.flush({ input: "q", output: "a", tags: ["knowledge"] });
    expect(outcome.sent).toBe(true);

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    // One trace plus three observations.
    expect(body.batch).toHaveLength(4);
    expect(body.batch[0].type).toBe("trace-create");
    expect(body.batch.map((e: { type: string }) => e.type)).toContain("generation-create");

    // Every observation must point at the trace, or it is orphaned and the
    // dashboard shows an empty trace.
    for (const event of body.batch.slice(1)) {
      expect(event.body.traceId).toBe(tracer.traceId);
    }
  });

  it("still sends the trace when a span failed", async () => {
    const spy = fakeOk();
    const tracer = new Tracer({ name: "test" });

    await expect(
      tracer.span("boom", {}, () => {
        throw new Error("failed");
      })
    ).rejects.toThrow();

    await tracer.flush({ input: "q", output: "a" });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const span = body.batch[1];
    expect(span.body.level).toBe("ERROR");
    expect(span.body.statusMessage).toBe("failed");
  });
});
