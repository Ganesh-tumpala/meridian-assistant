/**
 * Checks the knowledge base search.
 *
 * Retrieval is the part of the agent that quietly decides whether an answer
 * can be right at all. If the wrong passage comes back, no amount of prompting
 * downstream will save the answer, so these tests pin the behaviour that
 * matters: the right document wins, and a question about nothing returns
 * nothing.
 */

import { describe, it, expect } from "vitest";
import { search, tokenise, formatForPrompt } from "../lib/knowledge/retriever";
import { KNOWLEDGE_BASE } from "../lib/knowledge/documents";

describe("tokenise", () => {
  it("keeps figures whole so 25,000 survives as one token", () => {
    expect(tokenise("the limit is 25,000 pounds")).toContain("25,000");
  });

  it("drops words that carry no signal", () => {
    const tokens = tokenise("what is the fee for a card");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("what");
    expect(tokens).toContain("fee");
  });

  it("matches singular and plural to the same token", () => {
    expect(tokenise("cards")).toEqual(tokenise("card"));
    expect(tokenise("charges")).toEqual(tokenise("charge"));
  });
});

describe("search", () => {
  it("finds the overdraft document for an overdraft question", () => {
    const hits = search("How much is the unarranged overdraft fee?");
    expect(hits.length).toBeGreaterThan(0);
    const ids = hits.map((h) => h.document.id);
    expect(ids).toContain("accounts-overdraft");
  });

  it("finds the fraud document for a scam question", () => {
    const hits = search("Someone called asking for my PIN, is that real?");
    expect(hits.map((h) => h.document.id)).toContain("fraud-reporting");
  });

  it("finds the branch document for an opening hours question", () => {
    const hits = search("Are you open on Sunday?");
    expect(hits.map((h) => h.document.id)).toContain("branches-hours");
  });

  it("returns nothing for a question the knowledge base does not cover", () => {
    // This is what lets the agent say "I do not have that information" rather
    // than answering from whatever scored least badly.
    expect(search("what is the weather in Tokyo tomorrow")).toEqual([]);
  });

  it("ranks the best document first", () => {
    const hits = search("replacement card courier delivery cost");
    expect(hits[0].document.category).toBe("cards");
  });

  it("respects the category filter", () => {
    const hits = search("fee", { category: "payments" });
    for (const hit of hits) {
      expect(hit.document.category).toBe("payments");
    }
  });

  it("never returns more than the limit", () => {
    expect(search("fee", { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it("reports which words matched", () => {
    const hits = search("overdraft");
    expect(hits[0].matched).toContain("overdraft");
  });

  it("gives back an excerpt short enough to read", () => {
    const hits = search("international transfer");
    expect(hits[0].excerpt.length).toBeLessThanOrEqual(324);
    expect(hits[0].excerpt.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const first = search("overdraft fee");
    const second = search("overdraft fee");
    expect(first.map((h) => h.document.id)).toEqual(second.map((h) => h.document.id));
    expect(first.map((h) => h.score)).toEqual(second.map((h) => h.score));
  });
});

describe("formatForPrompt", () => {
  it("says so plainly when nothing was found", () => {
    expect(formatForPrompt([])).toMatch(/no relevant passages/i);
  });

  it("numbers the passages it includes", () => {
    const formatted = formatForPrompt(search("overdraft"));
    expect(formatted).toContain("[1]");
  });
});

describe("the knowledge base itself", () => {
  it("has no duplicate ids", () => {
    const ids = KNOWLEDGE_BASE.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every document a source to cite", () => {
    for (const doc of KNOWLEDGE_BASE) {
      expect(doc.source.trim(), `${doc.id} has no source`).not.toBe("");
    }
  });

  it("still contains the figures the acceptance questions depend on", () => {
    const all = KNOWLEDGE_BASE.map((d) => d.text).join(" ");
    for (const fact of ["0800 555 0199", "25,000", "6 pounds per day", "0800 555 0177", "closed on Sundays"]) {
      expect(all, `knowledge base is missing: ${fact}`).toContain(fact);
    }
  });
});
