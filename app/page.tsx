"use client";

/**
 * The chat page.
 *
 * This runs in the browser. It holds the list of messages, sends new ones to
 * the backend at /api/chat, and shows whatever comes back.
 *
 * Alongside each answer it shows what the agent actually did: which branch
 * took the question, which tools ran, and what the guardrail decided. That
 * panel is the point of the whole app. An answer you cannot inspect is an
 * answer you cannot trust.
 *
 * Notice there is no API key anywhere in this file. There must never be one
 * here, because anyone can read this code in their browser.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GREETING } from "@/config";
import { TopBar } from "@/app/components/shell";

type RunSummary = {
  runId: string;
  subgraph: string;
  status: string;
  tools: { tool: string; ok: boolean; ms: number }[];
  guardrail: { verdict: string; failed: string[] };
  citations: string[];
  traceId: string;
  totalMs: number;
  tracing: { enabled: boolean; sent: boolean; reason?: string };
};

type Message = {
  role: "user" | "assistant";
  content: string;
  run?: RunSummary;
};

// A simple id so the database can tell one conversation from another.
function newSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const SUGGESTIONS = [
  "How much is the unarranged overdraft fee?",
  "What's my current account balance?",
  "I've been overdrawn without an arrangement for 12 days. What will that cost?",
  "Someone called claiming to be from Meridian and asked for my PIN. Is that real?",
  "What's the overdraft fee at Barclays?",
];

const SUBGRAPH_TONE: Record<string, string> = {
  knowledge: "bg-indigo-50 text-indigo-700 border-indigo-200",
  accounts: "bg-sky-50 text-sky-700 border-sky-200",
  fraud: "bg-amber-50 text-amber-800 border-amber-200",
  escalation: "bg-purple-50 text-purple-700 border-purple-200",
  refusal: "bg-slate-100 text-slate-700 border-slate-200",
};

const VERDICT_TONE: Record<string, string> = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rewritten: "bg-amber-50 text-amber-800 border-amber-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
};

function RunPanel({ run }: { run: RunSummary }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 max-w-[85%] rounded-xl border border-slate-200 bg-slate-50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs ${
            SUBGRAPH_TONE[run.subgraph] ?? SUBGRAPH_TONE.refusal
          }`}
        >
          {run.subgraph}
        </span>
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs ${
            VERDICT_TONE[run.guardrail.verdict] ?? VERDICT_TONE.pass
          }`}
        >
          guardrail: {run.guardrail.verdict}
        </span>
        <span className="font-mono text-xs text-slate-500">
          {run.tools.length} tool{run.tools.length === 1 ? "" : "s"} · {run.totalMs}ms
        </span>
        <span className="ml-auto text-xs text-slate-500">{open ? "Hide" : "Details"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-xs">
          <div>
            <p className="pb-1 font-medium text-slate-700">Tools called</p>
            {run.tools.length === 0 ? (
              <p className="text-slate-500">None. This branch answers without looking anything up.</p>
            ) : (
              <ul className="space-y-1">
                {run.tools.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-slate-600">
                    <span className={t.ok ? "text-emerald-600" : "text-red-600"}>
                      {t.ok ? "✓" : "✕"}
                    </span>
                    <span>{t.tool}</span>
                    <span className="text-slate-400">{t.ms}ms</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {run.guardrail.failed.length > 0 && (
            <div>
              <p className="pb-1 font-medium text-slate-700">Guardrail concerns</p>
              <ul className="space-y-0.5 font-mono text-red-700">
                {run.guardrail.failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {run.citations.length > 0 && (
            <div>
              <p className="pb-1 font-medium text-slate-700">Sources</p>
              <ul className="space-y-0.5 text-slate-600">
                {run.citations.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-2">
            <Link href={`/runs/${run.runId}`} className="font-medium underline" style={{ color: "var(--brand)" }}>
              Full trace
            </Link>
            <span className="font-mono text-slate-400">{run.runId}</span>
            {!run.tracing.enabled && <span className="text-slate-500">Langfuse off</span>}
            {run.tracing.enabled && run.tracing.sent && (
              <span className="text-emerald-600">Sent to Langfuse</span>
            )}
            {run.tracing.enabled && !run.tracing.sent && (
              <span className="text-amber-700">Langfuse: {run.tracing.reason}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(newSessionId);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          sessionId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Something went wrong.");
      } else {
        setMessages([...next, { role: "assistant", content: data.reply, run: data.run }]);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar current="/" />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
        <div className="flex-1 space-y-4 overflow-y-auto py-6">
          {messages.map((m, i) => (
            <div key={i}>
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[15px] text-white"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-[15px] text-slate-800"
                  }
                  style={m.role === "user" ? { background: "var(--brand)" } : undefined}
                >
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              </div>
              {m.run && <RunPanel run={m.run} />}
            </div>
          ))}

          {messages.length === 1 && (
            <div className="pt-2">
              <p className="pb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                Try one of these
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:border-slate-400 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3">
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-200 py-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about cards, transfers, the app, or branches..."
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none focus:border-slate-400 disabled:opacity-60"
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              className="rounded-xl px-5 py-3 text-[15px] font-medium text-white disabled:opacity-40"
              style={{ background: "var(--brand)" }}
            >
              Send
            </button>
          </div>
          <p className="pt-2 text-center text-xs text-slate-400">
            A training exercise. Not a real bank.
          </p>
        </div>
      </div>
    </div>
  );
}
