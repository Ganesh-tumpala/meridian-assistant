/**
 * Checks every tool.
 *
 * The tools are the only part of the agent that is fully deterministic, which
 * makes them the part worth testing hardest. If a tool returns the wrong
 * figure, the guardrail downstream has no way of knowing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// create_handoff writes to the database, so the driver is replaced with a fake.
vi.mock("@neondatabase/serverless", () => ({
  neon: () => () => Promise.resolve([]),
}));

import { TOOLS, getTool, toolsForSubgraph, toolSchemas, describeTools } from "../lib/agent/tools";

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

async function run(name: string, args: Record<string, unknown>) {
  const tool = getTool(name);
  if (!tool) throw new Error(`no tool called ${name}`);
  return tool.run(args);
}

describe("the catalogue", () => {
  it("has at least ten tools", () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(10);
  });

  it("has no duplicate names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a description and at least one subgraph", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(20);
      expect(tool.subgraphs.length, `${tool.name} belongs to no subgraph`).toBeGreaterThan(0);
    }
  });

  it("marks only create_handoff as writing data", () => {
    expect(TOOLS.filter((t) => t.mutates).map((t) => t.name)).toEqual(["create_handoff"]);
  });

  it("builds schemas the Groq API will accept", () => {
    const schemas = toolSchemas(TOOLS) as {
      type: string;
      function: { name: string; parameters: { required: string[] } };
    }[];
    expect(schemas).toHaveLength(TOOLS.length);
    for (const schema of schemas) {
      expect(schema.type).toBe("function");
      expect(schema.function.name).toBeTruthy();
      expect(Array.isArray(schema.function.parameters.required)).toBe(true);
    }
  });

  it("describes tools for the planner without losing any", () => {
    const described = describeTools(TOOLS);
    for (const tool of TOOLS) {
      expect(described).toContain(tool.name);
    }
  });

  it("only offers the refusal branch no tools at all", () => {
    expect(toolsForSubgraph("refusal")).toHaveLength(0);
    expect(toolsForSubgraph("knowledge").length).toBeGreaterThan(0);
  });
});

describe("search_knowledge_base", () => {
  it("finds the overdraft passage", async () => {
    const result = await run("search_knowledge_base", { query: "unarranged overdraft fee" });
    expect(result.ok).toBe(true);
    expect(result.citations?.length).toBeGreaterThan(0);
  });

  it("fails cleanly when nothing matches", async () => {
    const result = await run("search_knowledge_base", { query: "weather in Tokyo" });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/nothing about/i);
  });

  it("fails cleanly when no query is given", async () => {
    expect((await run("search_knowledge_base", {})).ok).toBe(false);
  });

  it("widens the search when the planner guesses the wrong category", async () => {
    // A lost card lives in "cards", not "fraud". Filtering to the wrong
    // category must not hide the document that answers the question.
    const result = await run("search_knowledge_base", {
      query: "lost debit card what to do",
      category: "fraud",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.widenedSearch).toBe(true);
    expect(result.summary).toMatch(/every category was searched/i);
  });

  it("does not widen when the category was right", async () => {
    const result = await run("search_knowledge_base", {
      query: "unarranged overdraft fee",
      category: "accounts",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.widenedSearch).toBe(false);
  });
});

describe("calculate_overdraft_cost", () => {
  it("charges 6 pounds a day when unarranged", async () => {
    const result = await run("calculate_overdraft_cost", { type: "unarranged", days: 5 });
    expect(result.ok).toBe(true);
    expect(result.data?.total).toBe("30.00 pounds");
    expect(result.data?.capped).toBe(false);
  });

  it("applies the 60 pound monthly cap", async () => {
    const result = await run("calculate_overdraft_cost", { type: "unarranged", days: 20 });
    expect(result.data?.total).toBe("60.00 pounds");
    expect(result.data?.capped).toBe(true);
  });

  it("charges 35p a day when arranged", async () => {
    const result = await run("calculate_overdraft_cost", { type: "arranged", days: 10 });
    expect(result.data?.total).toBe("3.50 pounds");
  });

  it("rejects a negative number of days", async () => {
    expect((await run("calculate_overdraft_cost", { type: "arranged", days: -1 })).ok).toBe(false);
  });

  it("rejects an unknown overdraft type", async () => {
    expect((await run("calculate_overdraft_cost", { type: "casual", days: 1 })).ok).toBe(false);
  });
});

describe("check_transfer_limit", () => {
  it("accepts an amount inside the limit", async () => {
    const result = await run("check_transfer_limit", { amount: 500 });
    expect(result.data?.withinLimit).toBe(true);
  });

  it("rejects an amount over the limit and says how to raise it", async () => {
    const result = await run("check_transfer_limit", { amount: 30000 });
    expect(result.data?.withinLimit).toBe(false);
    expect(result.data?.excess).toBe("5000.00 pounds");
    expect(result.summary).toMatch(/cannot be raised in the app/i);
  });

  it("treats the limit itself as within the limit", async () => {
    expect((await run("check_transfer_limit", { amount: 25000 })).data?.withinLimit).toBe(true);
  });

  it("copes with an amount written as a string with symbols", async () => {
    const result = await run("check_transfer_limit", { amount: "£1,500" });
    expect(result.ok).toBe(true);
    expect(result.data?.withinLimit).toBe(true);
  });
});

describe("lookup_fee", () => {
  it("returns a known fee", async () => {
    const result = await run("lookup_fee", { fee: "unarranged_overdraft" });
    expect(result.data?.amount).toBe("6 pounds per day");
  });

  it("lists the known fees when asked for one that does not exist", async () => {
    const result = await run("lookup_fee", { fee: "made_up_fee" });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/known fees/i);
  });
});

describe("find_branch", () => {
  it("finds an exact postcode area", async () => {
    const result = await run("find_branch", { postcode: "SW1A 1AA" });
    expect(result.ok).toBe(true);
    expect(result.data?.matchType).toBe("exact");
  });

  it("suggests nearby branches when there is no exact match", async () => {
    const result = await run("find_branch", { postcode: "E17" });
    expect(result.data?.matchType).toBe("nearby");
  });

  it("rejects something that is not a postcode", async () => {
    expect((await run("find_branch", { postcode: "banana" })).ok).toBe(false);
  });
});

describe("get_opening_hours", () => {
  it("knows branches are closed on Sundays", async () => {
    const result = await run("get_opening_hours", { service: "branch", day: "sunday" });
    expect(String(result.data?.hours)).toMatch(/closed on Sundays/i);
  });

  it("knows the lost card line is always open", async () => {
    const result = await run("get_opening_hours", { service: "lost_card_line" });
    expect(result.data?.number).toBe("0800 555 0199");
  });
});

describe("assess_fraud_risk", () => {
  it("rates a PIN request as high risk", async () => {
    const result = await run("assess_fraud_risk", {
      description: "Someone called claiming to be from Meridian and asked for my PIN",
    });
    expect(result.data?.level).toBe("high");
    expect(result.data?.reportNumber).toBe("0800 555 0177");
  });

  it("flags the safe account scam", async () => {
    const result = await run("assess_fraud_risk", {
      description: "They told me to move my money to a safe account",
    });
    expect(String(JSON.stringify(result.data?.signals))).toMatch(/safe account/i);
  });
});

describe("check_request_permitted", () => {
  it("permits an ordinary published question", async () => {
    const result = await run("check_request_permitted", { request: "What are your opening hours?" });
    expect(result.data?.permitted).toBe(true);
  });

  it("refuses a request for the customer's own balance", async () => {
    const result = await run("check_request_permitted", { request: "What's my current account balance?" });
    expect(result.data?.permitted).toBe(false);
  });

  it("refuses a fee waiver", async () => {
    const result = await run("check_request_permitted", {
      request: "Can you waive my overdraft fee just this once?",
    });
    expect(result.data?.permitted).toBe(false);
  });

  it("refuses a question about another bank", async () => {
    const result = await run("check_request_permitted", { request: "What's the overdraft fee at Barclays?" });
    expect(result.data?.permitted).toBe(false);
  });

  it("refuses investment advice", async () => {
    const result = await run("check_request_permitted", {
      request: "I've got 20,000 pounds saved. Should I put it in stocks or leave it in savings?",
    });
    expect(result.data?.permitted).toBe(false);
  });

  it("refuses a Section 75 question", async () => {
    const result = await run("check_request_permitted", {
      request: "A shop refused my refund. Am I covered under Section 75?",
    });
    expect(result.data?.permitted).toBe(false);
  });

  it("refuses creative writing", async () => {
    const result = await run("check_request_permitted", {
      request: "Write me a short poem about online banking.",
    });
    expect(result.data?.permitted).toBe(false);
  });
});

describe("validate_sort_code", () => {
  it("accepts six digits", async () => {
    expect((await run("validate_sort_code", { sort_code: "20-30-40" })).ok).toBe(true);
  });

  it("rejects five digits", async () => {
    expect((await run("validate_sort_code", { sort_code: "20304" })).ok).toBe(false);
  });

  it("always says it cannot confirm the account exists", async () => {
    const result = await run("validate_sort_code", { sort_code: "203040", account_number: "12345678" });
    expect(String(result.data?.caveat)).toMatch(/cannot confirm/i);
  });
});

describe("convert_currency", () => {
  it("converts at the indicative rate", async () => {
    const result = await run("convert_currency", { amount: 100, currency: "EUR" });
    expect(result.data?.converted).toBe("117.00");
  });

  it("refuses a currency it holds no rate for", async () => {
    expect((await run("convert_currency", { amount: 100, currency: "XYZ" })).ok).toBe(false);
  });
});

describe("create_handoff", () => {
  it("returns a reference and a route even with no database", async () => {
    const result = await run("create_handoff", {
      reason: "Needs a person",
      urgency: "routine",
      summary: "Wants a fee waived",
    });
    expect(result.ok).toBe(true);
    expect(String(result.data?.reference)).toMatch(/^MER-/);
    expect(result.data?.saved).toBe(false);
  });

  it("points an emergency at the 24 hour line", async () => {
    const result = await run("create_handoff", {
      reason: "Active fraud",
      urgency: "emergency",
      summary: "Money moved to a safe account",
    });
    expect(String(result.data?.route)).toContain("0800 555 0177");
  });

  it("refuses to record a handoff with no summary", async () => {
    expect((await run("create_handoff", { reason: "x", urgency: "routine" })).ok).toBe(false);
  });
});

describe("every tool", () => {
  it("returns a result rather than throwing when given no arguments", async () => {
    for (const tool of TOOLS) {
      const result = await tool.run({});
      expect(typeof result.ok, `${tool.name} returned no ok flag`).toBe("boolean");
      expect(typeof result.summary, `${tool.name} returned no summary`).toBe("string");
    }
  });

  it("returns a result rather than throwing when given nonsense", async () => {
    for (const tool of TOOLS) {
      const result = await tool.run({ query: 1, amount: "abc", days: null, type: {}, fee: [] });
      expect(typeof result.ok, `${tool.name} threw on nonsense input`).toBe("boolean");
    }
  });
});
