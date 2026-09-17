/**
 * Handovers to a human.
 *
 * Every time the agent decided it could not deal with something itself, it
 * recorded a row here with a reference. This is the queue a real support team
 * would work through.
 */

import Link from "next/link";
import { Badge, EmptyState, Page, formatTime } from "@/app/components/shell";
import { databaseIsConfigured, getHandoffs, studentName } from "@/lib/db";

export const dynamic = "force-dynamic";

const URGENCY_TONE: Record<string, string> = {
  routine: "neutral",
  urgent: "warn",
  emergency: "bad",
};

export default async function HandoffsPage() {
  const student = studentName();

  if (!databaseIsConfigured()) {
    return (
      <Page current="/handoffs" title="Handoffs" subtitle="Requests that need a person.">
        <EmptyState title="No database is connected yet">
          Handoffs are recorded in Postgres. Set{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">
            DATABASE_URL
          </code>{" "}
          and restart. The agent still hands over correctly without one; it just keeps no queue.
        </EmptyState>
      </Page>
    );
  }

  let handoffs;
  try {
    handoffs = await getHandoffs(student, 50);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database query failed.";
    return (
      <Page current="/handoffs" title="Handoffs">
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
      current="/handoffs"
      title="Handoffs"
      subtitle={`${handoffs.length} request${handoffs.length === 1 ? "" : "s"} the agent passed to a person.`}
    >
      {handoffs.length === 0 ? (
        <EmptyState title="Nothing in the queue">
          Ask something only a person can do, such as{" "}
          <em>&ldquo;Can you waive my overdraft fee just this once?&rdquo;</em>, on the{" "}
          <Link href="/" className="underline" style={{ color: "var(--brand)" }}>
            chat page
          </Link>
          . The agent will record a handoff here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Urgency</th>
                <th className="px-4 py-3 font-medium">Summary</th>
                <th className="px-4 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {handoffs.map((handoff) => (
                <tr key={handoff.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {formatTime(handoff.created_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-700">
                    {handoff.reference}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={URGENCY_TONE[handoff.urgency] ?? "neutral"}>
                      {handoff.urgency}
                    </Badge>
                  </td>
                  <td className="max-w-sm px-4 py-3 text-slate-800">{handoff.summary}</td>
                  <td className="max-w-sm px-4 py-3 text-slate-600">{handoff.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
