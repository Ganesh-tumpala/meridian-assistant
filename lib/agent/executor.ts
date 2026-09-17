/**
 * The executor. Stage three.
 *
 * Runs the plan, one tool at a time, and records each call as its own span.
 *
 * A tool that fails does not stop the run. The failure is recorded and the
 * next step goes ahead, because a partial set of facts still beats no answer
 * at all, and the composer is told what it is missing.
 */

import { getTool } from "@/lib/agent/tools";
import type { ExecutedStep, Plan, ToolResult } from "@/lib/agent/types";
import type { Tracer } from "@/lib/trace";

/**
 * Fills in arguments the planner left out.
 *
 * Models routinely forget the obvious argument, most often the search query
 * itself. Supplying the question is far better than failing the step.
 */
function withDefaults(
  tool: string,
  args: Record<string, unknown>,
  question: string
): Record<string, unknown> {
  const filled = { ...args };

  if (tool === "search_knowledge_base" && !filled.query) {
    filled.query = question;
  }
  if (tool === "check_request_permitted" && !filled.request) {
    filled.request = question;
  }
  if (tool === "assess_fraud_risk" && !filled.description) {
    filled.description = question;
  }
  if (tool === "create_handoff") {
    if (!filled.summary) filled.summary = question;
    if (!filled.reason) filled.reason = "Needs a person to resolve.";
    if (!filled.urgency) filled.urgency = "routine";
  }

  return filled;
}

export async function execute(
  plan: Plan,
  question: string,
  tracer: Tracer
): Promise<ExecutedStep[]> {
  const executed: ExecutedStep[] = [];

  for (const step of plan.steps) {
    const startMs = Date.now();

    const result = await tracer.span(
      `tool:${step.tool}`,
      {
        type: "SPAN",
        input: { intent: step.intent, args: step.args },
        metadata: { stage: "execute", tool: step.tool, stepId: step.id },
      },
      async (end): Promise<ToolResult> => {
        const tool = getTool(step.tool);

        if (!tool) {
          const missing: ToolResult = {
            ok: false,
            summary: `There is no tool called "${step.tool}".`,
          };
          end({ output: missing, level: "WARNING", statusMessage: "unknown tool" });
          return missing;
        }

        const args = withDefaults(step.tool, step.args, question);

        try {
          const toolResult = await tool.run(args);
          end({
            output: toolResult,
            metadata: { argsUsed: args, mutates: tool.mutates },
            ...(toolResult.ok ? {} : { level: "WARNING" as const }),
          });
          return toolResult;
        } catch (error) {
          // A thrown tool is a bug, not an expected outcome. Record it loudly
          // but keep the run alive.
          const message = error instanceof Error ? error.message : "unknown error";
          const failure: ToolResult = {
            ok: false,
            summary: `The ${step.tool} tool failed: ${message}`,
          };
          end({ output: failure, level: "ERROR", statusMessage: message });
          return failure;
        }
      }
    );

    executed.push({ ...step, result, durationMs: Date.now() - startMs });
  }

  return executed;
}

/** The tool results written out for the composer to read. */
export function formatResults(steps: ExecutedStep[]): string {
  if (steps.length === 0) return "No tools were run.";

  return steps
    .map((step) => {
      const status = step.result.ok ? "OK" : "FAILED";
      const detail = step.result.data
        ? `\n  detail: ${JSON.stringify(step.result.data)}`
        : "";
      return `Step ${step.id} - ${step.tool} [${status}]\n  intent: ${step.intent}\n  result: ${step.result.summary}${detail}`;
    })
    .join("\n\n");
}

/** Every distinct source named by any step, for the citation list. */
export function collectCitations(steps: ExecutedStep[]): string[] {
  const all = steps.flatMap((s) => s.result.citations ?? []);
  return [...new Set(all)];
}
