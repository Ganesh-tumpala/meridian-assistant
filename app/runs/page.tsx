/**
 * The run list.
 *
 * One row per question the agent has answered. This is the page you open when
 * someone says "it gave me a strange answer" and you need to find that answer
 * and see what happened.
 */

import Link from "next/link";
import { Badge, EmptyState, Page, toneFor, formatTime } from "@/app/components/shell";
import { databaseIsConfigured, getRuns, studentName } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const student = studentName();

  if (!databaseIsConfigured()) {
    return (
      <Page current="/runs" title="Runs" subtitle="Every question the agent has answered.">
        <EmptyState title="No database is connected yet">
          Runs are recorded in Postgres. Set{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">
            DATABASE_URL
          </code>{" "}
          to your Neon connection string and restart. The chat works either way; without a
          database each run is shown once and then forgotten.
        </EmptyState>
      </Page>
    );
  }

  let runs;
  try {
    runs = await getRuns(student, 50);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database query failed.";
    return (
      <Page current="/runs" title="Runs">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-[15px] font-semibold text-red-800">Could not read the database</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-white p-3 text-xs whitespace-pre-wrap text-red-700">
            {message}
          </pre>
        </div>
      </Page>
    );
  }

  return (
    <Page
      current="/runs"
      title="Runs"
      subtitle={`The last ${runs.length} question${runs.length === 1 ? "" : "s"} answered as "${student}".`}
    >
      {runs.length === 0 ? (
        <EmptyState title="Nothing yet">
          Ask something on the{" "}
          <Link href="/" className="underline" style={{ color: "var(--brand)" }}>
            chat page
          </Link>{" "}
          and the full run will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Guardrail</th>
                <th className="px-4 py-3 font-medium">Tools</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.run_id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {formatTime(run.created_at)}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <Link
                      href={`/runs/${run.run_id}`}
                      className="font-medium underline"
                      style={{ color: "var(--brand)" }}
                    >
                      {run.question}
                    </Link>
                    <p className="pt-1 text-xs text-slate-500">{run.answer.slice(0, 110)}
                      {run.answer.length > 110 ? "..." : ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{run.subgraph}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={toneFor(run.guardrail_verdict)}>{run.guardrail_verdict}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {(run.tools_used ?? []).length === 0
                      ? "none"
                      : (run.tools_used ?? []).join(", ")}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-500">
                    {run.total_ms}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
