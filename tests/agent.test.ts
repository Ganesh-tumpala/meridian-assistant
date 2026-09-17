/**
 * Checks the routing rules, the plan validator and the tracer.
 *
 * These are the parts of the agent that decide what happens before any model
 * is involved, so they can be tested without spending a penny or waiting on
 * the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@neondatabase/serverless", () => ({
  neon: () => () => Promise.resolve([]),
}));

import { applyRules } from "../lib/agent/router";
import { validatePlan, fallbackPlan } from "../lib/agent/planner";
import { execute, formatResults, collectCitations } from "../lib/agent/executor";
import { SUBGRAPHS, getSubgraph, isSubgraphName } from "../lib/agent/subgraphs";
import { Tracer } from "../lib/trace";
import { langfuseIsConfigured, langfuseTraceUrl } from "../lib/langfuse";

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
});

describe("routing rules", () => {
  it("sends another bank's fees to refusal", () => {
    expect(applyRules("What's the overdraft fee at Barclays?")?.subgraph).toBe("refusal");
  });

  it("sends creative writing to refusal", () => {
    expect(applyRules("Write me a short poem about online banking.")?.subgraph).toBe("refusal");
  });

  it("sends investment advice to refusal", () => {
    expect(
      applyRules("I've got 20,000 pounds saved. Should I put it in stocks or leave it in savings?")
        ?.subgraph
    ).toBe("refusal");
  });

  it("sends a Section 75 question to refusal", () => {
    expect(applyRules("A shop refused my refund. Am I covered under Section 75?")?.subgraph).toBe(
      "refusal"
    );
  });

  it("sends a balance question to escalation, never to an answering branch", () => {
    const decision = applyRules("What's my current account balance?");
    expect(decision?.subgraph).toBe("escalation");
  });

  it("sends a fee waiver to escalation", () => {
    expect(
      applyRules("Can you waive my overdraft fee just this once? I'm a long-standing customer.")
        ?.subgraph
    ).toBe("escalation");
  });

  it("sends a scam report to fraud", () => {
    expect(
      applyRules("Someone called claiming to be from Meridian and asked for my PIN. Is that real?")
        ?.subgraph
    ).toBe("fraud");
  });

  it("leaves an ordinary question for the model to route", () => {
    expect(applyRules("How do I reset my app password?")).toBeNull();
  });

  it("explains itself whenever a rule fires", () => {
    const decision = applyRules("What's my current account balance?");
    expect(decision?.decidedBy).toBe("rule");
    expect(decision?.reasoning.length).toBeGreaterThan(10);
  });
});

describe("plan validation", () => {
  it("keeps steps that name a real tool", () => {
    const { steps } = validatePlan(
      [{ tool: "search_knowledge_base", intent: "look it up", args: { query: "fee" } }],
      "knowledge"
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe(1);
  });

  it("drops a tool that does not exist", () => {
    const { steps, dropped } = validatePlan([{ tool: "make_coffee", args: {} }], "knowledge");
    expect(steps).toHaveLength(0);
    expect(dropped[0]).toContain("make_coffee");
  });

  it("drops a tool the branch is not allowed to use", () => {
    // create_handoff belongs to escalation and fraud, not knowledge.
    const { steps, dropped } = validatePlan([{ tool: "create_handoff", args: {} }], "knowledge");
    expect(steps).toHaveLength(0);
    expect(dropped[0]).toContain("not available");
  });

  it("caps the number of steps", () => {
    const many = Array.from({ length: 12 }, () => ({ tool: "search_knowledge_base", args: {} }));
    expect(validatePlan(many, "knowledge").steps.length).toBeLessThanOrEqual(4);
  });

  it("copes with the model returning something that is not a list", () => {
    expect(validatePlan("not a list", "knowledge").steps).toEqual([]);
    expect(validatePlan(null, "knowledge").steps).toEqual([]);
  });

  it("numbers the surviving steps consecutively", () => {
    const { steps } = validatePlan(
      [
        { tool: "made_up", args: {} },
        { tool: "search_knowledge_base", args: {} },
        { tool: "lookup_fee", args: {} },
      ],
      "knowledge"
    );
    expect(steps.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("the fallback plan", () => {
  it("always searches the knowledge base", () => {
    const steps = fallbackPlan("what is the overdraft fee", "knowledge");
    expect(steps[0].tool).toBe("search_knowledge_base");
    expect(steps[0].args.query).toBe("what is the overdraft fee");
  });

  it("offers nothing on the refusal branch, which has no tools", () => {
    expect(fallbackPlan("anything", "refusal")).toEqual([]);
  });
});

describe("subgraphs", () => {
  it("has exactly one terminal branch", () => {
    expect(Object.values(SUBGRAPHS).filter((s) => s.terminal).map((s) => s.name)).toEqual([
      "refusal",
    ]);
  });

  it("falls back to knowledge for an unknown name", () => {
    expect(getSubgraph("nonsense").name).toBe("knowledge");
  });

  it("recognises real names only", () => {
    expect(isSubgraphName("fraud")).toBe(true);
    expect(isSubgraphName("nonsense")).toBe(false);
  });

  it("gives every branch guidance for the composer", () => {
    for (const branch of Object.values(SUBGRAPHS)) {
      expect(branch.composerGuidance.length, `${branch.name} has no guidance`).toBeGreaterThan(30);
    }
  });
});

describe("the executor", () => {
  it("runs a plan and records a result for every step", async () => {
    const tracer = new Tracer({ name: "test" });
    const steps = await execute(
      {
        subgraph: "knowledge",
        reasoning: "test",
        steps: [
          { id: 1, intent: "search", tool: "search_knowledge_base", args: { query: "overdraft fee" } },
          { id: 2, intent: "fee", tool: "lookup_fee", args: { fee: "unarranged_overdraft" } },
        ],
      },
      "what is the overdraft fee",
      tracer
    );

    expect(steps).toHaveLength(2);
    expect(steps.every((s) => typeof s.result.ok === "boolean")).toBe(true);
  });

  it("carries on after a step fails", async () => {
    const tracer = new Tracer({ name: "test" });
    const steps = await execute(
      {
        subgraph: "knowledge",
        reasoning: "test",
        steps: [
          { id: 1, intent: "bad", tool: "does_not_exist", args: {} },
          { id: 2, intent: "good", tool: "lookup_fee", args: { fee: "unarranged_overdraft" } },
        ],
      },
      "question",
      tracer
    );

    expect(steps).toHaveLength(2);
    expect(steps[0].result.ok).toBe(false);
    expect(steps[1].result.ok).toBe(true);
  });

  it("fills in a missing search query from the question", async () => {
    const tracer = new Tracer({ name: "test" });
    const steps = await execute(
      {
        subgraph: "knowledge",
        reasoning: "test",
        steps: [{ id: 1, intent: "search", tool: "search_knowledge_base", args: {} }],
      },
      "unarranged overdraft fee",
      tracer
    );
    expect(steps[0].result.ok).toBe(true);
  });

  it("collects citations without repeating them", async () => {
    const tracer = new Tracer({ name: "test" });
    const steps = await execute(
      {
        subgraph: "knowledge",
        reasoning: "test",
        steps: [
          { id: 1, intent: "a", tool: "lookup_fee", args: { fee: "unarranged_overdraft" } },
          { id: 2, intent: "b", tool: "lookup_fee", args: { fee: "international_transfer" } },
        ],
      },
      "fees",
      tracer
    );
    const citations = collectCitations(steps);
    expect(citations).toEqual([...new Set(citations)]);
  });

  it("writes the results out for the composer to read", () => {
    expect(formatResults([])).toMatch(/no tools/i);
  });
});

describe("the tracer", () => {
  it("records a span for work that succeeds", async () => {
    const tracer = new Tracer({ name: "test" });
    const value = await tracer.span("step", {}, () => 42);
    expect(value).toBe(42);
    expect(tracer.timeline()).toHaveLength(1);
    expect(tracer.timeline()[0].name).toBe("step");
  });

  it("still records a span when the work throws, then rethrows", async () => {
    const tracer = new Tracer({ name: "test" });
    await expect(
      tracer.span("failing", {}, () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const timeline = tracer.timeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].level).toBe("ERROR");
    expect(timeline[0].statusMessage).toBe("boom");
  });

  it("keeps spans in the order they finished", async () => {
    const tracer = new Tracer({ name: "test" });
    await tracer.span("first", {}, () => null);
    await tracer.span("second", {}, () => null);
    expect(tracer.timeline().map((s) => s.name)).toEqual(["first", "second"]);
  });

  it("does not try to send anything when Langfuse is not configured", async () => {
    const tracer = new Tracer({ name: "test" });
    await tracer.span("step", {}, () => null);
    const outcome = await tracer.flush({ input: "q", output: "a" });
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/not set/i);
  });
});

describe("langfuse configuration", () => {
  it("is off when the keys are missing", () => {
    expect(langfuseIsConfigured()).toBe(false);
  });

  it("is on once both keys are present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    expect(langfuseIsConfigured()).toBe(true);
  });

  it("is still off with only one key", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    expect(langfuseIsConfigured()).toBe(false);
  });

  it("builds a dashboard link for a trace", () => {
    expect(langfuseTraceUrl("abc123")).toMatch(/\/trace\/abc123$/);
  });
});
