/**
 * Saves messages, agent runs and handoffs to the Neon Postgres database.
 *
 * If DATABASE_URL is missing the app still works, it just does not save
 * anything. That is deliberate so a missing database never breaks the chat.
 *
 * Everyone on the course shares one database, so every row is labelled with
 * STUDENT_NAME. That is how you find your own messages, and how the
 * instructor finds them too.
 */

import { neon } from "@neondatabase/serverless";

export type Role = "user" | "assistant";

/** One row of the messages table, as the /data page reads it back. */
export type StoredMessage = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  student_name: string | null;
  created_at: string;
};

/** One row of the runs table, as the /runs pages read it back. */
export type StoredRun = {
  id: number;
  run_id: string;
  session_id: string;
  student_name: string | null;
  question: string;
  answer: string;
  subgraph: string;
  status: string;
  guardrail_verdict: string;
  tools_used: string[] | null;
  trace_id: string | null;
  total_ms: number;
  detail: unknown;
  created_at: string;
};

export type StoredHandoff = {
  id: number;
  reference: string;
  student_name: string | null;
  reason: string;
  urgency: string;
  summary: string;
  created_at: string;
};

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export function databaseIsConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Your name, as it gets written onto every row you save.
 *
 * Set STUDENT_NAME in your environment variables. If you forget, your rows
 * are labelled "unknown", which still works but makes them hard to find.
 */
export function studentName(): string {
  const name = process.env.STUDENT_NAME;
  if (typeof name !== "string" || name.trim() === "") return "unknown";
  return name.trim();
}

/**
 * Creates the tables the first time they are needed.
 *
 * Every statement here is written so that running it a second time changes
 * nothing. That matters, because this runs on every single chat request.
 * The ALTER is what adds student_name to a table that was created before
 * this column existed.
 */
export async function ensureTable(): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      session_id    TEXT        NOT NULL,
      role          TEXT        NOT NULL,
      content       TEXT        NOT NULL,
      student_name  TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS student_name TEXT
  `;

  // Everyone's rows live in one table, so looking up one student's messages
  // is the only query this app ever runs. An index makes that fast.
  await sql`
    CREATE INDEX IF NOT EXISTS messages_student_name_idx
    ON messages (student_name)
  `;

  // One row per question the agent answered, with the whole run kept as JSON
  // so the run detail page can rebuild the timeline exactly.
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id                BIGSERIAL PRIMARY KEY,
      run_id            TEXT        NOT NULL,
      session_id        TEXT        NOT NULL,
      student_name      TEXT,
      question          TEXT        NOT NULL,
      answer            TEXT        NOT NULL,
      subgraph          TEXT        NOT NULL,
      status            TEXT        NOT NULL,
      guardrail_verdict TEXT        NOT NULL,
      tools_used        TEXT[],
      trace_id          TEXT,
      total_ms          INTEGER     NOT NULL DEFAULT 0,
      detail            JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS runs_student_name_idx ON runs (student_name)`;
  await sql`CREATE INDEX IF NOT EXISTS runs_run_id_idx ON runs (run_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS handoffs (
      id            BIGSERIAL PRIMARY KEY,
      reference     TEXT        NOT NULL,
      student_name  TEXT,
      reason        TEXT        NOT NULL,
      urgency       TEXT        NOT NULL,
      summary       TEXT        NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS handoffs_student_name_idx ON handoffs (student_name)`;
}

export async function saveMessage(
  sessionId: string,
  role: Role,
  content: string,
  student: string = studentName()
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    INSERT INTO messages (session_id, role, content, student_name)
    VALUES (${sessionId}, ${role}, ${content}, ${student})
  `;
}

/** The most recent messages saved by one student, newest first. */
export async function getMessages(
  student: string = studentName(),
  limit = 100
): Promise<StoredMessage[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql`
    SELECT id, session_id, role, content, student_name, created_at
    FROM messages
    WHERE student_name = ${student}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows as StoredMessage[];
}

/** How many messages that student has saved in total, not just the recent ones. */
export async function countMessages(
  student: string = studentName()
): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  const rows = await sql`
    SELECT COUNT(*) AS total
    FROM messages
    WHERE student_name = ${student}
  `;
  return Number((rows as { total: string | number }[])[0]?.total ?? 0);
}

/* -------------------------------------------------------------------------
 *  Runs
 * ----------------------------------------------------------------------- */

export type RunToSave = {
  runId: string;
  sessionId: string;
  question: string;
  answer: string;
  subgraph: string;
  status: string;
  guardrailVerdict: string;
  toolsUsed: string[];
  traceId: string;
  totalMs: number;
  detail: unknown;
};

export async function saveRun(
  run: RunToSave,
  student: string = studentName()
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    INSERT INTO runs (
      run_id, session_id, student_name, question, answer, subgraph,
      status, guardrail_verdict, tools_used, trace_id, total_ms, detail
    )
    VALUES (
      ${run.runId}, ${run.sessionId}, ${student}, ${run.question}, ${run.answer},
      ${run.subgraph}, ${run.status}, ${run.guardrailVerdict}, ${run.toolsUsed},
      ${run.traceId}, ${run.totalMs}, ${JSON.stringify(run.detail)}
    )
  `;
}

export async function getRuns(
  student: string = studentName(),
  limit = 50
): Promise<StoredRun[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql`
    SELECT id, run_id, session_id, student_name, question, answer, subgraph,
           status, guardrail_verdict, tools_used, trace_id, total_ms, detail, created_at
    FROM runs
    WHERE student_name = ${student}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows as StoredRun[];
}

export async function getRun(
  runId: string,
  student: string = studentName()
): Promise<StoredRun | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`
    SELECT id, run_id, session_id, student_name, question, answer, subgraph,
           status, guardrail_verdict, tools_used, trace_id, total_ms, detail, created_at
    FROM runs
    WHERE run_id = ${runId} AND student_name = ${student}
    LIMIT 1
  `;
  return (rows as StoredRun[])[0] ?? null;
}

/** The numbers the dashboard shows, worked out in the database. */
export type RunStats = {
  total: number;
  blocked: number;
  errors: number;
  avgMs: number;
  bySubgraph: { subgraph: string; count: number }[];
  byVerdict: { verdict: string; count: number }[];
};

export async function getRunStats(
  student: string = studentName()
): Promise<RunStats> {
  const sql = getSql();
  if (!sql) {
    return { total: 0, blocked: 0, errors: 0, avgMs: 0, bySubgraph: [], byVerdict: [] };
  }

  const totals = (await sql`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
           COUNT(*) FILTER (WHERE status = 'error')   AS errors,
           COALESCE(AVG(total_ms), 0) AS avg_ms
    FROM runs
    WHERE student_name = ${student}
  `) as { total: string; blocked: string; errors: string; avg_ms: string }[];

  const bySubgraph = (await sql`
    SELECT subgraph, COUNT(*) AS count
    FROM runs
    WHERE student_name = ${student}
    GROUP BY subgraph
    ORDER BY count DESC
  `) as { subgraph: string; count: string }[];

  const byVerdict = (await sql`
    SELECT guardrail_verdict AS verdict, COUNT(*) AS count
    FROM runs
    WHERE student_name = ${student}
    GROUP BY guardrail_verdict
    ORDER BY count DESC
  `) as { verdict: string; count: string }[];

  const row = totals[0];
  return {
    total: Number(row?.total ?? 0),
    blocked: Number(row?.blocked ?? 0),
    errors: Number(row?.errors ?? 0),
    avgMs: Math.round(Number(row?.avg_ms ?? 0)),
    bySubgraph: bySubgraph.map((r) => ({ subgraph: r.subgraph, count: Number(r.count) })),
    byVerdict: byVerdict.map((r) => ({ verdict: r.verdict, count: Number(r.count) })),
  };
}

/* -------------------------------------------------------------------------
 *  Handoffs
 * ----------------------------------------------------------------------- */

export async function saveHandoff(
  handoff: { reference: string; reason: string; urgency: string; summary: string },
  student: string = studentName()
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  await ensureTable();
  await sql`
    INSERT INTO handoffs (reference, student_name, reason, urgency, summary)
    VALUES (${handoff.reference}, ${student}, ${handoff.reason}, ${handoff.urgency}, ${handoff.summary})
  `;
  return true;
}

export async function getHandoffs(
  student: string = studentName(),
  limit = 50
): Promise<StoredHandoff[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql`
    SELECT id, reference, student_name, reason, urgency, summary, created_at
    FROM handoffs
    WHERE student_name = ${student}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows as StoredHandoff[];
}
