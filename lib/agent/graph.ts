/**
 * The graph. This is the whole agent in one function.
 *
 *   route  ->  plan  ->  execute  ->  compose  ->  guard
 *
 * Every stage opens a span, so the trace tells the same story as this file.
 * A stage that fails hands on a safe default rather than throwing, because a
 * customer waiting for an answer should get one even when a stage misbehaves.
 */

import { compose } from "@/lib/agent/composer";
import { collectCitations, execute } from "@/lib/agent/executor";
import { guard } from "@/lib/agent/guardrail";
import { plan } from "@/lib/agent/planner";
import { route } from "@/lib/agent/router";
import { getSubgraph } from "@/lib/agent/subgraphs";
import { Tracer, type SpanRecord } from "@/lib/trace";
import { langfuseIsConfigured } from "@/lib/langfuse";
import type { RunResult } from "@/lib/agent/types";

export type RunOptions = {
  question: string;
  sessionId: string;
  studentName?: string;
};

export type RunOutcome = RunResult & {
  timeline: SpanRecord[];
  tracing: { enabled: boolean; sent: boolean; reason?: string };
};

function newRunId(): string {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgent(options: RunOptions): Promise<RunOutcome> {
  const { question, sessionId, studentName } = options;
  const runId = newRunId();
  const startMs = Date.now();

  const tracer = new Tracer({
    name: "meridian-assistant",
    sessionId,
    userId: studentName,
  });

  let outcome: RunOutcome;

  try {
    // 1. Which branch handles this?
    const routing = await route(question, tracer);
    const branch = getSubgraph(routing.subgraph);

    // 2. What needs to be looked up?
    const built = await plan(question, routing.subgraph, tracer);
    const fullPlan = { ...built, reasoning: `${routing.reasoning} ${built.reasoning}`.trim() };

    // 3. Look it up.
    const steps = await execute(fullPlan, question, tracer);

    // 4. Turn it into a sentence.
    const draft = await compose(question, routing.subgraph, steps, tracer);

    // 5. Check the sentence before anyone sees it.
    const guardrail = await guard(draft, routing.subgraph, steps, question, tracer);

    outcome = {
      runId,
      sessionId,
      question,
      status: guardrail.verdict === "blocked" ? "blocked" : "ok",
      subgraph: routing.subgraph,
      plan: fullPlan,
      steps,
      guardrail,
      answer: guardrail.finalAnswer,
      citations: collectCitations(steps),
      traceId: tracer.traceId,
      totalMs: Date.now() - startMs,
      timeline: tracer.timeline(),
      tracing: { enabled: langfuseIsConfigured(), sent: false },
    };

    void branch; // the branch is recorded through the plan; kept for clarity
  } catch (error) {
    // Something outside the per-stage handling went wrong. Still answer.
    const message = error instanceof Error ? error.message : "unknown error";

    outcome = {
      runId,
      sessionId,
      question,
      status: "error",
      subgraph: "knowledge",
      plan: { subgraph: "knowledge", reasoning: "The run failed before a plan was made.", steps: [] },
      steps: [],
      guardrail: {
        verdict: "blocked",
        checks: [{ name: "run completed", passed: false, detail: message }],
        draftAnswer: "",
        finalAnswer:
          "Something went wrong at our end. Please try again, or call the general phone line, open Monday to Saturday 08:00 to 20:00.",
      },
      answer:
        "Something went wrong at our end. Please try again, or call the general phone line, open Monday to Saturday 08:00 to 20:00.",
      citations: [],
      traceId: tracer.traceId,
      totalMs: Date.now() - startMs,
      error: message,
      timeline: tracer.timeline(),
      tracing: { enabled: langfuseIsConfigured(), sent: false },
    };
  }

  // Post the trace last, and wait for it. On serverless the process can be
  // frozen as soon as the response is sent, so a fire-and-forget would be lost.
  const flushed = await tracer.flush({
    input: question,
    output: outcome.answer,
    metadata: {
      runId,
      subgraph: outcome.subgraph,
      status: outcome.status,
      guardrailVerdict: outcome.guardrail.verdict,
      toolsUsed: outcome.steps.map((s) => s.tool),
      totalMs: outcome.totalMs,
    },
    tags: [outcome.subgraph, outcome.status, `guardrail:${outcome.guardrail.verdict}`],
  });

  outcome.tracing = {
    enabled: langfuseIsConfigured(),
    sent: flushed.sent,
    reason: flushed.reason,
  };

  return outcome;
}
