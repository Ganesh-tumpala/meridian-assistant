/**
 * The planner. Stage two.
 *
 * Writes the list of tool calls before any of them run. Planning first, rather
 * than letting the model improvise one call at a time, means the whole plan is
 * visible in the trace and can be judged on its own.
 *
 * The plan is validated against the real tool list. A step naming a tool that
 * does not exist, or one the subgraph is not allowed to use, is dropped here
 * rather than failing later.
 */

import { askGroqJson } from "@/lib/groq";
import { describeTools, toolsForSubgraph } from "@/lib/agent/tools";
import { getSubgraph } from "@/lib/agent/subgraphs";
import type { Plan, PlanStep, SubgraphName } from "@/lib/agent/types";
import type { Tracer } from "@/lib/trace";

const MAX_STEPS = 4;

function buildPrompt(subgraph: SubgraphName): string {
  const tools = toolsForSubgraph(subgraph);
  const branch = getSubgraph(subgraph);

  return `You plan the work for Meridian Bank's assistant, on the "${branch.title}" branch.

That branch handles: ${branch.purpose}

Available tools:

${describeTools(tools)}

Write a plan of at most ${MAX_STEPS} tool calls that gathers everything needed to answer.

Rules:
- Every factual answer starts with search_knowledge_base. Never answer from memory.
- Use check_request_permitted whenever the request could be account-specific, a fee waiver, or advice.
- On the escalation branch, finish with create_handoff so the customer gets a reference.
- Only use tools from the list above, with exactly the argument names shown.
- Fewer steps is better. Do not add a step whose answer you already have.

Reply with JSON only, in this shape:
{"reasoning": "<one sentence on the approach>",
 "steps": [{"intent": "<why this step>", "tool": "<tool name>", "args": {}}]}`;
}

/** Keeps only the steps that name a real, permitted tool. */
export function validatePlan(
  rawSteps: unknown,
  subgraph: SubgraphName
): { steps: PlanStep[]; dropped: string[] } {
  const allowed = new Set(toolsForSubgraph(subgraph).map((t) => t.name));
  const steps: PlanStep[] = [];
  const dropped: string[] = [];

  if (!Array.isArray(rawSteps)) return { steps, dropped };

  for (const raw of rawSteps.slice(0, MAX_STEPS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as { tool?: unknown; intent?: unknown; args?: unknown };
    const tool = String(candidate.tool ?? "").trim();

    if (!tool) {
      dropped.push("(step with no tool name)");
      continue;
    }
    if (!allowed.has(tool)) {
      dropped.push(`${tool} (not available on the ${subgraph} branch)`);
      continue;
    }

    steps.push({
      id: steps.length + 1,
      intent: String(candidate.intent ?? "").trim() || `Call ${tool}.`,
      tool,
      args:
        typeof candidate.args === "object" && candidate.args !== null
          ? (candidate.args as Record<string, unknown>)
          : {},
    });
  }

  return { steps, dropped };
}

/**
 * A plan to fall back on when the model cannot produce one.
 *
 * Searching the knowledge base is always a defensible first move, so a failed
 * planner degrades to a plain retrieval answer rather than to nothing.
 */
export function fallbackPlan(question: string, subgraph: SubgraphName): PlanStep[] {
  const allowed = new Set(toolsForSubgraph(subgraph).map((t) => t.name));
  const steps: PlanStep[] = [];

  if (allowed.has("search_knowledge_base")) {
    steps.push({
      id: steps.length + 1,
      intent: "Find any published passage that answers this.",
      tool: "search_knowledge_base",
      args: { query: question },
    });
  }
  if (allowed.has("check_request_permitted")) {
    steps.push({
      id: steps.length + 1,
      intent: "Confirm an assistant is allowed to answer this.",
      tool: "check_request_permitted",
      args: { request: question },
    });
  }
  return steps;
}

export async function plan(
  question: string,
  subgraph: SubgraphName,
  tracer: Tracer
): Promise<Plan> {
  // The refusal branch is terminal: there is nothing to look up.
  if (getSubgraph(subgraph).terminal) {
    return {
      subgraph,
      reasoning: "Out of scope, so no tools are needed.",
      steps: [],
    };
  }

  return tracer.span(
    "planner",
    {
      type: "GENERATION",
      input: { question, subgraph },
      metadata: { stage: "plan" },
    },
    async (end) => {
      try {
        const raw = await askGroqJson<{ reasoning?: string; steps?: unknown }>(
          [
            { role: "system", content: buildPrompt(subgraph) },
            { role: "user", content: question },
          ],
          { temperature: 0 }
        );

        const { steps, dropped } = validatePlan(raw.steps, subgraph);
        const finalSteps = steps.length > 0 ? steps : fallbackPlan(question, subgraph);

        const result: Plan = {
          subgraph,
          reasoning:
            raw.reasoning?.trim() ||
            (steps.length > 0 ? "Planned by the model." : "Model produced no usable steps; using the default plan."),
          steps: finalSteps,
        };

        end({
          output: result,
          metadata: { droppedSteps: dropped, usedFallback: steps.length === 0 },
          ...(dropped.length > 0 ? { level: "WARNING" as const } : {}),
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        const result: Plan = {
          subgraph,
          reasoning: `Planner failed (${message}). Falling back to a knowledge base search.`,
          steps: fallbackPlan(question, subgraph),
        };
        end({ output: result, level: "WARNING", statusMessage: message });
        return result;
      }
    }
  );
}
