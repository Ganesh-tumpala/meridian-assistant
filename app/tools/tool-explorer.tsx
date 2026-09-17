"use client";

/**
 * The interactive half of the tools page.
 *
 * This is a client component, so it must never import the tool code itself.
 * The tools reach into the database and the knowledge base, and importing them
 * here would drag all of that into the browser bundle. It receives a plain
 * description of each tool instead and calls /api/tools to actually run one.
 */

import { useState } from "react";

/** A tool as the server describes it: plain data, safe to send to the browser. */
export type ToolSummary = {
  name: string;
  description: string;
  mutates: boolean;
  subgraphs: string[];
  parameters: {
    name: string;
    type: "string" | "number" | "boolean";
    description: string;
    required: boolean;
    enum?: string[];
  }[];
};

type Outcome = {
  ok?: boolean;
  summary?: string;
  data?: Record<string, unknown>;
  error?: string;
  ms?: number;
};

function ToolCard({ tool }: { tool: ToolSummary }) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setOutcome(null);

    // Send numbers as numbers. The tools coerce strings anyway, but this keeps
    // what the form sends identical to what the model would send.
    const typed: Record<string, unknown> = {};
    for (const param of tool.parameters) {
      const raw = args[param.name];
      if (raw === undefined || raw === "") continue;
      typed[param.name] = param.type === "number" ? Number(raw) : raw;
    }

    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.name, args: typed }),
      });
      const data = await res.json();
      setOutcome(
        res.ok
          ? { ok: data.result?.ok, summary: data.result?.summary, data: data.result?.data, ms: data.ms }
          : { error: data.error }
      );
    } catch {
      setOutcome({ error: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-[15px] font-semibold text-slate-800">{tool.name}</h3>
        {tool.mutates && (
          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs text-amber-800">
            writes data
          </span>
        )}
      </div>
      <p className="pt-2 text-sm leading-relaxed text-slate-600">{tool.description}</p>
      <p className="pt-2 font-mono text-xs text-slate-500">
        branches: {tool.subgraphs.join(", ")}
      </p>

      <div className="space-y-2 pt-4">
        {tool.parameters.map((param) => (
          <label key={param.name} className="block">
            <span className="font-mono text-xs text-slate-600">
              {param.name}
              {param.required ? " *" : ""}
            </span>
            {param.enum ? (
              <select
                value={args[param.name] ?? ""}
                onChange={(e) => setArgs({ ...args, [param.name]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {param.enum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={args[param.name] ?? ""}
                onChange={(e) => setArgs({ ...args, [param.name]: e.target.value })}
                placeholder={param.description}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            )}
          </label>
        ))}
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "var(--brand)" }}
      >
        {busy ? "Running..." : "Run tool"}
      </button>

      {outcome && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {outcome.error ? (
            <p className="text-sm text-red-700">{outcome.error}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs ${
                    outcome.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {outcome.ok ? "ok" : "failed"}
                </span>
                <span className="font-mono text-xs text-slate-400">{outcome.ms}ms</span>
              </div>
              <p className="pt-2 text-sm text-slate-700">{outcome.summary}</p>
              {outcome.data && (
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
                  {JSON.stringify(outcome.data, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolExplorer({ tools }: { tools: ToolSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} />
      ))}
    </div>
  );
}
