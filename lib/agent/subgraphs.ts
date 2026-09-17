/**
 * The subgraphs.
 *
 * A subgraph is a branch of the agent with its own tools and its own house
 * style. Routing to one early keeps each branch small: the fraud branch never
 * has to think about exchange rates, and the refusal branch never runs a tool
 * at all.
 */

import type { Subgraph, SubgraphName } from "@/lib/agent/types";

export const SUBGRAPHS: Record<SubgraphName, Subgraph> = {
  knowledge: {
    name: "knowledge",
    title: "Knowledge",
    purpose:
      "General questions about Meridian's published products, fees, hours and app. The default branch.",
    composerGuidance:
      "Answer only from the retrieved passages. Quote figures exactly as the passage writes them, including the word pounds rather than a currency symbol. If the passages do not contain the answer, say so plainly.",
    terminal: false,
  },
  accounts: {
    name: "accounts",
    title: "Accounts and payments",
    purpose:
      "Questions involving a calculation or a limit, such as what an overdraft costs or whether a payment fits the daily limit.",
    composerGuidance:
      "Give the figure the tool returned, never one you worked out yourself. State the final figure plainly and do not show your own workings, because an intermediate number you calculated is exactly the kind of figure that turns out to be wrong. Never state or guess a customer's own balance.",
    terminal: false,
  },
  fraud: {
    name: "fraud",
    title: "Fraud and security",
    purpose:
      "Suspected fraud, scam calls, and anything where the customer may be at risk right now.",
    composerGuidance:
      "Lead with the action to take and the number to call. Always repeat that Meridian never asks for a full password, a PIN or a one-time code. Be brief and calm; this person may be in the middle of a scam.",
    terminal: false,
  },
  escalation: {
    name: "escalation",
    title: "Human handover",
    purpose:
      "Requests a person must handle: complaints, disputes, bereavement, account closure, or anything account-specific.",
    composerGuidance:
      "Say clearly that you cannot do this yourself and why, in one sentence, without apologising twice. Then give the handoff reference and the exact route to a person, with opening hours.",
    terminal: false,
  },
  refusal: {
    name: "refusal",
    title: "Out of scope",
    purpose:
      "Anything outside Meridian's services: other banks, financial or legal advice, and off-topic requests such as creative writing.",
    composerGuidance:
      "Decline in one or two sentences. Name the reason without lecturing. Offer the one thing you can do instead, if there is one. Do not answer any part of the original question.",
    terminal: true,
  },
};

export const SUBGRAPH_NAMES = Object.keys(SUBGRAPHS) as SubgraphName[];

export function getSubgraph(name: string): Subgraph {
  return SUBGRAPHS[name as SubgraphName] ?? SUBGRAPHS.knowledge;
}

export function isSubgraphName(value: string): value is SubgraphName {
  return value in SUBGRAPHS;
}
