/**
 * The dashboard.
 *
 * One screen that answers "is this thing working, and what has it been
 * doing". Everything here is read on the server on each request, so it is
 * always current.
 */

import Link from "next/link";
import { MODEL } from "@/config";
import { Badge, Card, EmptyState, Page, Stat, toneFor } from "@/app/components/shell";
import { databaseIsConfigured, getRunStats, studentName } from "@/lib/db";
import { langfuseHost, langfuseIsConfigured } from "@/lib/langfuse";
import { TOOLS } from "@/lib/agent/tools";
import { KNOWLEDGE_BASE } from "@/lib/knowledge/documents";
import { SUBGRAPHS } from "@/lib/agent/subgraphs";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const student = studentName();
  const configured = databaseIsConfigured();

  let stats = { total: 0, blocked: 0, errors: 0, avgMs: 0, bySubgraph: [] as { subgraph: string; count: number }[], byVerdict: [] as { verdict: string; count: number }[] };
  let dbError: string | null = null;

  if (configured) {
    try {
      stats = await getRunStats(student);
    } catch (error) {
      dbError = error instanceof Error ? error.message : "The database query failed.";
    }
  }

  const checks = [
    {
      name: "Model",
      ok: Boolean(process.env.GROQ_API_KEY),
      detail: Boolean(process.env.GROQ_API_KEY) ? MODEL : "GROQ_API_KEY is not set.",
    },
    {
      name: "Database",
      ok: configured,
      detail: configured ? `Connected, saving as "${student}".` : "DATABASE_URL is not set. Nothing is saved.",
    },
    {
      name: "Tracing",
      ok: langfuseIsConfigured(),
      detail: langfuseIsConfigured()
        ? `Sending traces to ${langfuseHost()}.`
        : "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are not set. The agent still works; traces are kept locally only.",
    },
  ];

  return (
    <Page
      current="/dashboard"
      title="Dashboard"
      subtitle={`Everything recorded under "${student}".`}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Runs" value={stats.total} hint="Questions the agent answered" />
          <Stat
            label="Blocked"
            value={stats.blocked}
            hint="Stopped by the answer guardrail"
          />
          <Stat label="Errors" value={stats.errors} hint="Runs that failed outright" />
          <Stat label="Average time" value={`${stats.avgMs}ms`} hint="End to end" />
        </div>

        <Card title="System" description="What is switched on right now.">
          <ul className="divide-y divide-slate-100">
            {checks.map((check) => (
              <li key={check.name} className="flex flex-wrap items-center gap-3 py-2.5">
                <Badge tone={check.ok ? "good" : "warn"}>{check.ok ? "ready" : "off"}</Badge>
                <span className="text-sm font-medium text-slate-800">{check.name}</span>
                <span className="text-sm text-slate-600">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Capability" description="What the agent has to work with.">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-semibold text-slate-900">{TOOLS.length}</p>
                <p className="text-xs text-slate-500">tools</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-slate-900">{KNOWLEDGE_BASE.length}</p>
                <p className="text-xs text-slate-500">documents</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-slate-900">
                  {Object.keys(SUBGRAPHS).length}
                </p>
                <p className="text-xs text-slate-500">subgraphs</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-4">
              <Link href="/tools" className="text-sm underline" style={{ color: "var(--brand)" }}>
                Browse tools
              </Link>
              <span className="text-slate-300">·</span>
              <Link href="/knowledge" className="text-sm underline" style={{ color: "var(--brand)" }}>
                Browse knowledge
              </Link>
            </div>
          </Card>

          <Card title="Guardrail verdicts" description="What happened to each answer before it went out.">
            {stats.byVerdict.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {stats.byVerdict.map((row) => (
                  <li key={row.verdict} className="flex items-center gap-3">
                    <Badge tone={toneFor(row.verdict)}>{row.verdict}</Badge>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (row.count / Math.max(stats.total, 1)) * 100)}%`,
                          background: "var(--brand)",
                        }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-sm text-slate-600">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Which branch took the question" description="How the router split the traffic.">
          {stats.bySubgraph.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing yet. Ask a question on the chat page.</p>
          ) : (
            <ul className="space-y-2">
              {stats.bySubgraph.map((row) => (
                <li key={row.subgraph} className="flex items-center gap-3">
                  <span className="w-24 font-mono text-sm text-slate-700">{row.subgraph}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (row.count / Math.max(stats.total, 1)) * 100)}%`,
                        background: "var(--brand)",
                      }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-sm text-slate-600">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {dbError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5">
            <h2 className="text-[15px] font-semibold text-red-800">Could not read the database</h2>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-red-200 bg-white p-3 text-xs whitespace-pre-wrap text-red-700">
              {dbError}
            </pre>
          </div>
        )}

        {!configured && (
          <EmptyState title="No database is connected yet">
            The agent runs fine without one, it just keeps no history. Set{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">
              DATABASE_URL
            </code>{" "}
            to your Neon connection string and restart to start recording runs.
          </EmptyState>
        )}
      </div>
    </Page>
  );
}
