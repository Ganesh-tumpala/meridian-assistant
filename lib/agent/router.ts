/**
 * The router. Stage one.
 *
 * Decides which subgraph handles the question before any work is done.
 *
 * It asks the model, but it does not trust the model blindly. A set of rules
 * runs first, and a rule that fires overrides the model. Those rules cover the
 * cases where being wrong is expensive: a request for someone's balance must
 * never be routed to a branch that would try to answer it.
 */

import { askGroqJson } from "@/lib/groq";
import { getTool } from "@/lib/agent/tools";
import { isSubgraphName, SUBGRAPHS } from "@/lib/agent/subgraphs";
import type { SubgraphName } from "@/lib/agent/types";
import type { Tracer } from "@/lib/trace";

export type RoutingDecision = {
  subgraph: SubgraphName;
  reasoning: string;
  /** "rule" when a hard rule decided it, "model" when the model did. */
  decidedBy: "rule" | "model" | "fallback";
};

/**
 * Rules that override the model.
 *
 * Order matters. The first rule that matches wins, so the most serious
 * categories are checked first.
 */
const HARD_RULES: { name: string; test: RegExp; subgraph: SubgraphName; why: string }[] = [
  {
    name: "other-bank",
    test: /\b(barclays|hsbc|natwest|lloyds|santander|halifax|monzo|starling|revolut|nationwide|tsb|chase|co-?op bank)\b/i,
    subgraph: "refusal",
    why: "Names a different bank. Meridian's assistant does not answer for other banks.",
  },
  {
    name: "creative-writing",
    test: /\b(write|compose)\b[^.?!]{0,40}\b(poem|song|story|joke|haiku|limerick|essay|rap)\b/i,
    subgraph: "refusal",
    why: "Asks for creative writing, which is outside the assistant's scope.",
  },
  {
    name: "investment-advice",
    test: /\b(should i|would you|do you recommend).{0,40}\b(invest|stocks?|shares?|isa|pension|savings account|put it in)\b/i,
    subgraph: "refusal",
    why: "Asks for regulated financial advice.",
  },
  {
    name: "legal-advice",
    test: /\bsection 75\b|\bchargeback\b|\bam i covered\b|\bmy (legal )?rights\b|\bombudsman\b/i,
    subgraph: "refusal",
    why: "Asks for legal advice or a dispute outcome.",
  },
  {
    name: "account-specific",
    test: /\bmy\s+(current\s+)?(account\s+)?balance\b|\bhow much (do i have|money do i|is in my)\b|\bam i overdrawn\b|\bmy (recent )?transactions?\b/i,
    subgraph: "escalation",
    why: "Asks about a specific customer's account, which an assistant cannot see.",
  },
  {
    name: "fee-waiver",
    test: /\b(waive|refund|cancel|remove).{0,30}\b(fee|charge)\b|\bjust this once\b/i,
    subgraph: "escalation",
    why: "Asks to change a fee for an individual, which an assistant cannot authorise.",
  },
  {
    name: "complaint-or-dispute",
    test: /\b(complain|complaint|disputed? (transaction|payment)|close my account|bereave|power of attorney|deceased)\b/i,
    subgraph: "escalation",
    why: "Complaints, disputes and life events are always handled by a person.",
  },
  {
    name: "active-fraud",
    test: /\b(scam|fraud|phish|suspicious|someone called|claiming to be|stolen|safe account|unauthorised)\b/i,
    subgraph: "fraud",
    why: "Describes possible fraud, which takes priority over everything else.",
  },
  {
    name: "calculation",
    test: /\b(how much|what would|calculate|work out|cost).{0,40}\b(overdraft|overdrawn|transfer|limit|days?)\b/i,
    subgraph: "accounts",
    why: "Needs a figure worked out rather than looked up.",
  },
];

/** Runs the rules and returns the first match, if any. */
export function applyRules(question: string): RoutingDecision | null {
  for (const rule of HARD_RULES) {
    if (rule.test.test(question)) {
      return {
        subgraph: rule.subgraph,
        reasoning: `Rule "${rule.name}": ${rule.why}`,
        decidedBy: "rule",
      };
    }
  }
  return null;
}

const ROUTER_PROMPT = `You route customer questions for Meridian Bank to the right handler.

Choose exactly one:

${Object.values(SUBGRAPHS)
  .map((s) => `- "${s.name}": ${s.purpose}`)
  .join("\n")}

Guidance:
- A question about Meridian's published information goes to "knowledge".
- A question needing a figure worked out goes to "accounts".
- Anything about a specific customer's own account goes to "escalation". The assistant cannot see customer accounts.
- Another bank, financial advice, legal advice or an off-topic request goes to "refusal".

Reply with JSON only: {"subgraph": "<name>", "reasoning": "<one short sentence>"}`;

export async function route(
  question: string,
  tracer: Tracer
): Promise<RoutingDecision> {
  return tracer.span(
    "router",
    { type: "SPAN", input: { question }, metadata: { stage: "route" } },
    async (end) => {
      // A hard rule wins outright and saves a model call.
      const ruled = applyRules(question);
      if (ruled) {
        end({ output: ruled, metadata: { decidedBy: "rule" } });
        return ruled;
      }

      // The policy tool is a second opinion the model cannot talk its way past.
      const policy = getTool("check_request_permitted");
      const policyResult = policy ? await policy.run({ request: question }) : null;
      const policyBlocked =
        policyResult?.data && (policyResult.data as { permitted?: boolean }).permitted === false;

      try {
        const decision = await askGroqJson<{ subgraph?: string; reasoning?: string }>(
          [
            { role: "system", content: ROUTER_PROMPT },
            { role: "user", content: question },
          ],
          { temperature: 0 }
        );

        const name = String(decision.subgraph ?? "").toLowerCase();
        let subgraph: SubgraphName = isSubgraphName(name) ? name : "knowledge";

        // If policy says a human is needed, never let the model send this to
        // a branch that would answer it directly.
        if (policyBlocked && (subgraph === "knowledge" || subgraph === "accounts")) {
          subgraph = "escalation";
        }

        const result: RoutingDecision = {
          subgraph,
          reasoning: decision.reasoning?.trim() || "Routed by the model.",
          decidedBy: "model",
        };
        end({ output: result, metadata: { decidedBy: "model", policyBlocked } });
        return result;
      } catch (error) {
        // A routing failure must not take the whole request down. Knowledge is
        // the safe default because its composer refuses to invent anything.
        const message = error instanceof Error ? error.message : "unknown error";
        const result: RoutingDecision = {
          subgraph: policyBlocked ? "escalation" : "knowledge",
          reasoning: `Router failed (${message}). Fell back to a safe branch.`,
          decidedBy: "fallback",
        };
        end({ output: result, level: "WARNING", statusMessage: message });
        return result;
      }
    }
  );
}
