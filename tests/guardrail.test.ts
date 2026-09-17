/**
 * Checks the answer guardrail.
 *
 * This is the last thing between the model and the customer, so these tests
 * are written as "would this have gone out". Each one is a specific way a bank
 * assistant causes real harm.
 */

import { describe, it, expect } from "vitest";
import { inspect, repair } from "../lib/agent/guardrail";
import type { ExecutedStep } from "../lib/agent/types";

/** A tool result to check answers against, as the executor would produce it. */
function steps(summary: string, data?: Record<string, unknown>): ExecutedStep[] {
  return [
    {
      id: 1,
      intent: "test",
      tool: "search_knowledge_base",
      args: {},
      durationMs: 1,
      result: { ok: true, summary, data },
    },
  ];
}

const NONE: ExecutedStep[] = [];

describe("invented balances", () => {
  it("blocks an answer that states a balance", () => {
    const report = inspect(
      "Your current balance is 1,240.50 pounds.",
      "knowledge",
      NONE,
      "What's my current account balance?"
    );
    expect(report.verdict).toBe("blocked");
    expect(report.finalAnswer).toMatch(/no access to customer accounts/i);
  });

  it("blocks it even when the figure uses a currency symbol", () => {
    const report = inspect(
      "Your account balance is £532.10 as of today.",
      "knowledge",
      NONE,
      "what is my balance"
    );
    expect(report.verdict).toBe("blocked");
  });

  it("allows a correct refusal that names no figure", () => {
    const report = inspect(
      "I have no access to customer accounts, so I cannot see your balance. You can check it in the Meridian app.",
      "escalation",
      NONE,
      "What's my current account balance?"
    );
    expect(report.verdict).not.toBe("blocked");
  });

  it("does not block a fee that happens to sit near the word account", () => {
    const report = inspect(
      "The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per calendar month.",
      "knowledge",
      steps("unarranged overdraft is 6 pounds per day capped at 60 pounds", {
        total: "6 pounds",
        cap: "60 pounds",
      }),
      "How much is the unarranged overdraft fee?"
    );
    expect(report.verdict).not.toBe("blocked");
  });
});

describe("unauthorised promises", () => {
  it("blocks an assistant claiming to have waived a fee", () => {
    const report = inspect(
      "I have waived the fee for you this time as a gesture of goodwill.",
      "escalation",
      NONE,
      "Can you waive my overdraft fee just this once?"
    );
    expect(report.verdict).toBe("blocked");
  });

  it("blocks an assistant claiming to have raised a limit", () => {
    const report = inspect(
      "I have raised your limit to 50,000 pounds for today.",
      "accounts",
      NONE,
      "raise my limit"
    );
    expect(report.verdict).toBe("blocked");
  });

  it("allows an answer that explains it cannot waive anything", () => {
    const report = inspect(
      "I am not able to waive a fee. A colleague on the general phone line can look at this with you.",
      "escalation",
      NONE,
      "Can you waive my overdraft fee?"
    );
    expect(report.verdict).not.toBe("blocked");
  });
});

describe("phone numbers", () => {
  it("blocks a number that is not Meridian's", () => {
    const report = inspect(
      "Please call us on 0800 123 4567 and we will help you.",
      "knowledge",
      NONE,
      "who do I call"
    );
    expect(report.verdict).toBe("blocked");
  });

  it("allows the real lost card line", () => {
    const report = inspect(
      "Report a lost card on 0800 555 0199, which is open 24 hours a day.",
      "knowledge",
      steps("lost card line is 0800 555 0199, open 24 hours"),
      "I lost my card"
    );
    expect(report.verdict).not.toBe("blocked");
  });

  it("allows the real fraud line", () => {
    const report = inspect(
      "Report this on 0800 555 0177 straight away.",
      "fraud",
      steps("report fraud on 0800 555 0177"),
      "someone asked for my PIN"
    );
    expect(report.verdict).not.toBe("blocked");
  });
});

describe("refusals actually refuse", () => {
  it("flags an out-of-scope answer that answers anyway", () => {
    const report = inspect(
      "Barclays charges around 5 pounds a day for an unarranged overdraft.",
      "refusal",
      NONE,
      "What's the overdraft fee at Barclays?"
    );
    const check = report.checks.find((c) => c.name === "refusal is a refusal");
    expect(check?.passed).toBe(false);
  });

  it("passes a proper decline", () => {
    const report = inspect(
      "I cannot help with other banks' fees. I can only answer questions about Meridian Bank.",
      "refusal",
      NONE,
      "What's the overdraft fee at Barclays?"
    );
    const check = report.checks.find((c) => c.name === "refusal is a refusal");
    expect(check?.passed).toBe(true);
  });

  it("recognises a decline written with a curly apostrophe", () => {
    // Models write "can’t", not "can't". The two look identical on screen,
    // so a check that misses this reports a correct refusal as a failure.
    const report = inspect(
      "I’m sorry, but I can’t create poems. I can tell you about our online banking services instead.",
      "refusal",
      NONE,
      "Write me a short poem about online banking."
    );
    const check = report.checks.find((c) => c.name === "refusal is a refusal");
    expect(check?.passed).toBe(true);
    expect(report.verdict).not.toBe("blocked");
  });

  it("replaces a blocked out-of-scope answer with scope wording, not account wording", () => {
    const report = inspect(
      "Barclays charges 5 pounds a day. Call them on 0345 734 5345.",
      "refusal",
      NONE,
      "What's the overdraft fee at Barclays?"
    );
    expect(report.verdict).toBe("blocked");
    expect(report.finalAnswer).toMatch(/only answer questions about Meridian/i);
    expect(report.finalAnswer).not.toMatch(/no access to customer accounts/i);
  });
});

describe("typographic punctuation", () => {
  it("normalises curly quotes and non-breaking hyphens", () => {
    const { text, changes } = repair(
      "Meridian will never ask for a one‑time code — not ever."
    );
    expect(text).toContain("one-time");
    expect(text).toContain("-");
    expect(changes.join(" ")).toMatch(/typographic/i);
  });
});

describe("internal language", () => {
  it("flags an answer that mentions its own tools", () => {
    const report = inspect(
      "According to my knowledge base, the fee is 6 pounds per day.",
      "knowledge",
      steps("6 pounds per day"),
      "overdraft fee"
    );
    const check = report.checks.find((c) => c.name === "no internal language");
    expect(check?.passed).toBe(false);
  });
});

describe("empty answers", () => {
  it("blocks an answer that is barely there", () => {
    expect(inspect("Yes.", "knowledge", NONE, "are you open").verdict).toBe("blocked");
  });
});

describe("repair", () => {
  it("rewrites a currency symbol as the word pounds", () => {
    const { text, changes } = repair("The fee is £6 per day.");
    expect(text).toBe("The fee is 6 pounds per day.");
    expect(changes.join(" ")).toMatch(/currency/i);
  });

  it("handles a symbol with a space and a thousands separator", () => {
    expect(repair("The limit is £ 25,000 per day.").text).toBe(
      "The limit is 25,000 pounds per day."
    );
  });

  it("strips bold markers", () => {
    expect(repair("The fee is **6 pounds per day**.").text).toBe("The fee is 6 pounds per day.");
  });

  it("strips bullet and heading markers", () => {
    expect(repair("- first\n- second").text).toBe("first\nsecond");
    expect(repair("## Heading\ntext").text).toBe("Heading\ntext");
  });

  it("leaves a clean answer completely alone", () => {
    const clean = "The unarranged overdraft fee is 6 pounds per day.";
    const { text, changes } = repair(clean);
    expect(text).toBe(clean);
    expect(changes).toEqual([]);
  });
});

describe("verdicts", () => {
  it("passes a clean, sourced answer unchanged", () => {
    const answer =
      "The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per calendar month.";
    const report = inspect(
      answer,
      "knowledge",
      steps("6 pounds per day, capped at 60 pounds per calendar month"),
      "overdraft fee"
    );
    expect(report.verdict).toBe("pass");
    expect(report.finalAnswer).toBe(answer);
  });

  it("marks an answer rewritten when it only needed tidying", () => {
    const report = inspect(
      "The unarranged overdraft fee is **£6 per day**.",
      "knowledge",
      steps("6 pounds per day"),
      "overdraft fee"
    );
    expect(report.verdict).toBe("rewritten");
    expect(report.finalAnswer).toContain("6 pounds per day");
    expect(report.finalAnswer).not.toContain("£");
    expect(report.finalAnswer).not.toContain("**");
  });

  it("keeps the draft so the run page can show what changed", () => {
    const draft = "The fee is **£6 per day**.";
    const report = inspect(draft, "knowledge", steps("6 pounds per day"), "fee");
    expect(report.draftAnswer).toBe(draft);
    expect(report.finalAnswer).not.toBe(draft);
  });

  it("always reports every check it ran", () => {
    const report = inspect("The fee is 6 pounds per day.", "knowledge", steps("6 pounds"), "fee");
    const names = report.checks.map((c) => c.name);
    expect(names).toContain("no invented balance");
    expect(names).toContain("no unauthorised promise");
    expect(names).toContain("phone numbers are real");
    expect(names).toContain("figures are sourced");
  });
});
