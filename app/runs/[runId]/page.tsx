/**
 * One run, in full.
 *
 * The plan the agent wrote, every tool call with its arguments and its result,
 * what the composer drafted, and what the guardrail decided about it. If an
 * answer was wrong, the reason is on this page.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Page, toneFor, formatTime } from "@/app/components/shell";
import { databaseIsConfigured, getRun, studentName } from "@/lib/db";
import { langfuseIsConfigured, langfuseTraceUrl } from "@/lib/langfuse";
import type { ExecutedStep, GuardrailReport, Plan } from "@/lib/agent/types";
import type { SpanRecord } from "@/lib/trace";

export const dynamic = "force-dynamic";

type RunDetail = {
  plan?: Plan;
  steps?: ExecutedStep[];
  guardrail?: GuardrailReport;
  timeline?: SpanRecord[];
  citations?: string[];
};

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const student = studentName();

  if (!databaseIsConfigured()) {
    return (
      <Page current="/runs" title="Run detail">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-[15px] font-semibold text-slate-800">No database is connected</h2>
          <p className="pt-2 text-sm text-slate-600">
            Runs are read back from Postgres. Set{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">
              DATABASE_URL
            </code>{" "}
            and restart to keep run history.
          </p>
        </div>
      </Page>
    );
  }

  let run;
  try {
    run = await getRun(runId, student);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database query failed.";
    return (
      <Page current="/runs" title="Run detail">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-[15px] font-semibold text-red-800">Could not read the database</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-white p-3 text-xs whitespace-pre-wrap text-red-700">
            {message}
          </pre>
        </div>
      </Page>
    );
  }

  if (!run) notFound();

  const detail = (run.detail ?? {}) as RunDetail;
  const steps = detail.steps ?? [];
  const guardrail = detail.guardrail;
  const timeline = detail.timeline ?? [];
  const slowest = Math.max(...timeline.map((s) => s.durationMs), 1);

  return (
    <Page
      current="/runs"
      title="Run detail"
      subtitle={formatTime(run.created_at)}
      actions={
        <Link
          href="/runs"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          All runs
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneFor(run.status)}>{run.status}</Badge>
          <Badge>{run.subgraph}</Badge>
          <Badge tone={toneFor(run.guardrail_verdict)}>guardrail: {run.guardrail_verdict}</Badge>
          <Badge>{run.total_ms}ms</Badge>
          <span className="font-mono text-xs text-slate-400">{run.run_id}</span>
          {langfuseIsConfigured() && run.trace_id && (
            <a
              href={langfuseTraceUrl(run.trace_id)}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline"
              style={{ color: "var(--brand)" }}
            >
              Open in Langfuse
            </a>
          )}
        </div>

        <Card title="Question">
          <p className="text-[15px] text-slate-800">{run.question}</p>
        </Card>

        <Card title="Answer" description="What the customer saw.">
          <p className="text-[15px] whitespace-pre-wrap text-slate-800">{run.answer}</p>
          {(detail.citations ?? []).length > 0 && (
            <p className="pt-3 text-xs text-slate-500">
              Sources: {(detail.citations ?? []).join(" · ")}
            </p>
          )}
        </Card>

        {detail.plan && (
          <Card title="Plan" description={detail.plan.reasoning}>
            {detail.plan.steps.length === 0 ? (
              <p className="text-sm text-slate-500">
                No tools planned. This branch answers without looking anything up.
              </p>
            ) : (
              <ol className="space-y-2">
                {detail.plan.steps.map((step) => (
                  <li key={step.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{step.id}</span>
                      <span className="font-mono text-sm text-slate-800">{step.tool}</span>
                    </div>
                    <p className="pt-1 text-sm text-slate-600">{step.intent}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        <Card title="Tool calls" description="What each tool was asked and what it gave back.">
          {steps.length === 0 ? (
            <p className="text-sm text-slate-500">No tools ran.</p>
          ) : (
            <div className="space-y-3">
              {steps.map((step) => (
                <details
                  key={step.id}
                  className="rounded-lg border border-slate-200 bg-white"
                  open={!step.result.ok}
                >
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5">
                    <Badge tone={step.result.ok ? "good" : "bad"}>
                      {step.result.ok ? "ok" : "failed"}
                    </Badge>
                    <span className="font-mono text-sm text-slate-800">{step.tool}</span>
                    <span className="font-mono text-xs text-slate-400">{step.durationMs}ms</span>
                  </summary>
                  <div className="space-y-3 border-t border-slate-100 px-3 py-3">
                    <div>
                      <p className="pb-1 text-xs font-medium text-slate-500">Arguments</p>
                      <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
                        {JSON.stringify(step.args, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="pb-1 text-xs font-medium text-slate-500">Result</p>
                      <p className="text-sm text-slate-700">{step.result.summary}</p>
                      {step.result.data && (
                        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
                          {JSON.stringify(step.result.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>

        {guardrail && (
          <Card
            title="Guardrail"
            description={
              guardrail.verdict === "blocked"
                ? "The draft answer was replaced before it reached the customer."
                : guardrail.verdict === "rewritten"
                  ? "The draft answer was tidied up before it went out."
                  : "The draft answer went out unchanged."
            }
          >
            <ul className="divide-y divide-slate-100">
              {guardrail.checks.map((check) => (
                <li key={check.name} className="flex flex-wrap items-baseline gap-3 py-2">
                  <Badge tone={check.passed ? "good" : "bad"}>
                    {check.passed ? "pass" : "fail"}
                  </Badge>
                  <span className="text-sm font-medium text-slate-800">{check.name}</span>
                  <span className="text-sm text-slate-600">{check.detail}</span>
                </li>
              ))}
            </ul>

            {guardrail.verdict !== "pass" && guardrail.draftAnswer && (
              <div className="pt-4">
                <p className="pb-1 text-xs font-medium text-slate-500">
                  What the composer originally wrote
                </p>
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm whitespace-pre-wrap text-slate-700">
                  {guardrail.draftAnswer}
                </p>
              </div>
            )}
          </Card>
        )}

        {timeline.length > 0 && (
          <Card title="Timeline" description="Every stage, in the order it ran.">
            <ul className="space-y-1.5">
              {timeline.map((span) => (
                <li key={span.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate font-mono text-xs text-slate-700">
                    {span.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (span.durationMs / slowest) * 100)}%`,
                        background: span.level === "ERROR" ? "#dc2626" : span.level === "WARNING" ? "#d97706" : "var(--brand)",
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-slate-500">
                    {span.durationMs}ms
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
