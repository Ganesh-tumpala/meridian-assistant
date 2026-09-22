/**
 * The backend.
 *
 * This runs on the server, not in the browser. That matters: your API key
 * lives here and is never sent to the user.
 *
 * What it does, in order:
 *   1. reads the message the user typed
 *   2. runs the agent: route, plan, execute, compose, guard
 *   3. checks the final answer for details that never appeared in the fact
 *      sheet (a phone number, a fee, an opening time), as a warning only
 *   4. saves the question, the answer and the whole run to the database
 *   5. sends the answer back to the page, with the run attached so the UI
 *      can show which tools were used and what the guardrail decided
 */

import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/graph";
import { GroqError } from "@/lib/groq";
import { findUngrounded } from "@/lib/grounding";
import { BANK_FACTS } from "@/config";
import {
  ensureTable,
  saveMessage,
  saveRun,
  databaseIsConfigured,
  studentName,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type Incoming = {
  messages?: { role: string; content: string }[];
  sessionId?: string;
};

export async function POST(request: NextRequest) {
  let body: Incoming;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";

  const latest = history[history.length - 1];
  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return NextResponse.json({ error: "No user message was sent." }, { status: 400 });
  }

  const question = latest.content.trim();
  const student = studentName();

  let run;
  try {
    run = await runAgent({ question, sessionId, studentName: student });
  } catch (error) {
    const status = error instanceof GroqError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Something went wrong talking to the model.";
    console.error("chat route failed:", message);
    return NextResponse.json({ error: message }, { status });
  }

  // Groundedness is a warning, not a filter. The customer still sees the
  // answer; the UI just flags anything that never appeared in the facts.
  const ungrounded = findUngrounded(run.answer, BANK_FACTS);

  // Saving must never break the chat, so failures here are logged only.
  if (databaseIsConfigured()) {
    try {
      await ensureTable();
      await saveMessage(sessionId, "user", question, student);
      await saveMessage(sessionId, "assistant", run.answer, student);
      await saveRun(
        {
          runId: run.runId,
          sessionId,
          question,
          answer: run.answer,
          subgraph: run.subgraph,
          status: run.status,
          guardrailVerdict: run.guardrail.verdict,
          toolsUsed: run.steps.map((s) => s.tool),
          traceId: run.traceId,
          totalMs: run.totalMs,
          detail: {
            plan: run.plan,
            steps: run.steps,
            guardrail: run.guardrail,
            timeline: run.timeline,
            citations: run.citations,
            ungrounded,
          },
        },
        student
      );
    } catch (error) {
      console.error("could not save to the database:", error);
    }
  }

  return NextResponse.json({
    reply: run.answer,
    run: {
      runId: run.runId,
      subgraph: run.subgraph,
      status: run.status,
      tools: run.steps.map((s) => ({ tool: s.tool, ok: s.result.ok, ms: s.durationMs })),
      guardrail: {
        verdict: run.guardrail.verdict,
        failed: run.guardrail.checks.filter((c) => !c.passed).map((c) => c.name),
      },
      citations: run.citations,
      traceId: run.traceId,
      totalMs: run.totalMs,
      tracing: run.tracing,
      ungrounded,
    },
  });
}
