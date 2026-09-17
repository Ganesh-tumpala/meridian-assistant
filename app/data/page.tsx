/**
 * The /data page.
 *
 * Shows the messages your app has saved, so you never have to open the Neon
 * dashboard to check whether saving is working.
 *
 * This is a server component: it runs on the server and talks to the
 * database directly. There is no "use client" at the top, so none of this
 * code is sent to the browser and the database URL stays private.
 */

import Link from "next/link";
import { Code, EmptyState, Page, formatTime } from "@/app/components/shell";
import {
  countMessages,
  databaseIsConfigured,
  getMessages,
  studentName,
  type StoredMessage,
} from "@/lib/db";

// Never cache this page. It should show what is in the database right now,
// not what was there when the site was built.
export const dynamic = "force-dynamic";

const HOW_MANY = 100;

export default async function DataPage() {
  const student = studentName();

  // No database configured. That is a normal state, not an error, so say so
  // plainly instead of crashing.
  if (!databaseIsConfigured()) {
    return (
      <Page current="/data" title="Saved messages" subtitle={`Rows labelled ${student}`}>
        <EmptyState title="No database is connected yet">
          The chat still works without one, it just does not save anything. To start saving,
          set <Code>DATABASE_URL</Code> to your Neon connection string and restart the app. On
          Vercel that is under Settings, Environment Variables.
        </EmptyState>
      </Page>
    );
  }

  // The database is configured, but it can still be unreachable or the URL
  // can be wrong. Catch that and show what went wrong rather than a crash.
  let rows: StoredMessage[];
  let total: number;
  try {
    rows = await getMessages(student, HOW_MANY);
    total = await countMessages(student);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The database query failed.";
    return (
      <Page current="/data" title="Saved messages" subtitle={`Rows labelled ${student}`}>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-[15px] font-semibold text-red-800">
            Could not read the database
          </h2>
          <p className="pt-2 text-sm text-red-700">
            Check that <Code>DATABASE_URL</Code> is the full Neon connection string. The exact
            error was:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-white p-3 text-xs whitespace-pre-wrap text-red-700">
            {message}
          </pre>
        </div>
      </Page>
    );
  }

  return (
    <Page
      current="/data"
      title="Saved messages"
      subtitle={`Rows labelled ${student}`}
    >
      <p className="pb-4 text-sm text-slate-600">
        {total === 0 ? (
          <>
            Nothing saved yet. Send a message on the{" "}
            <Link href="/" className="underline" style={{ color: "var(--brand)" }}>
              chat page
            </Link>{" "}
            and it will appear here.
          </>
        ) : (
          <>
            <strong className="font-semibold text-slate-800">{total}</strong>{" "}
            {total === 1 ? "message" : "messages"} saved in total
            {total > HOW_MANY ? `, showing the most recent ${HOW_MANY}` : ""}.
          </>
        )}
      </p>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {formatTime(row.created_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{row.role}</td>
                  <td className="px-4 py-3 whitespace-pre-wrap text-slate-800">
                    {row.content}
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
