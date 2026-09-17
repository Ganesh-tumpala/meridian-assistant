/**
 * The shapes every part of the agent passes around.
 *
 * Read this file first. Everything else refers back to these types, so once
 * you know what a Plan and a RunResult look like, the rest of the agent
 * reads like plain English.
 */

/* -------------------------------------------------------------------------
 *  Tools
 * ----------------------------------------------------------------------- */

/** One argument a tool accepts, described so the model knows how to fill it. */
export type ToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  /** When present, the model must pick one of these exact values. */
  enum?: string[];
};

/** Whatever a tool hands back. `ok: false` is an expected outcome, not a crash. */
export type ToolResult = {
  ok: boolean;
  /** Short human-readable summary. This is what the composer actually reads. */
  summary: string;
  /** Structured detail, shown on the run page and available to the composer. */
  data?: Record<string, unknown>;
  /** Where the answer came from, so the composer can cite it. */
  citations?: string[];
};

export type Tool = {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Which subgraphs are allowed to call this tool. */
  subgraphs: SubgraphName[];
  /** True when the tool changes something rather than just reading. */
  mutates: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

/* -------------------------------------------------------------------------
 *  Subgraphs
 * ----------------------------------------------------------------------- */

export type SubgraphName =
  | "knowledge"
  | "accounts"
  | "fraud"
  | "escalation"
  | "refusal";

export type Subgraph = {
  name: SubgraphName;
  title: string;
  /** Shown on the /runs page so a reader can see why this branch was taken. */
  purpose: string;
  /** Extra instructions folded into the composer for this branch only. */
  composerGuidance: string;
  /** A subgraph that refuses never reaches the planner. */
  terminal: boolean;
};

/* -------------------------------------------------------------------------
 *  Planner, executor, composer
 * ----------------------------------------------------------------------- */

export type PlanStep = {
  id: number;
  /** Why this step exists, in the planner's own words. */
  intent: string;
  tool: string;
  args: Record<string, unknown>;
};

export type Plan = {
  subgraph: SubgraphName;
  reasoning: string;
  steps: PlanStep[];
};

export type ExecutedStep = PlanStep & {
  result: ToolResult;
  durationMs: number;
};

/* -------------------------------------------------------------------------
 *  Guardrail
 * ----------------------------------------------------------------------- */

export type GuardrailVerdict = "pass" | "rewritten" | "blocked";

export type GuardrailCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type GuardrailReport = {
  verdict: GuardrailVerdict;
  checks: GuardrailCheck[];
  /** The answer the user actually sees after the guardrail has had its say. */
  finalAnswer: string;
  /** The answer before the guardrail touched it, kept for the run page. */
  draftAnswer: string;
};

/* -------------------------------------------------------------------------
 *  A whole run
 * ----------------------------------------------------------------------- */

export type RunStatus = "ok" | "blocked" | "error";

export type RunResult = {
  runId: string;
  sessionId: string;
  question: string;
  status: RunStatus;
  subgraph: SubgraphName;
  plan: Plan;
  steps: ExecutedStep[];
  guardrail: GuardrailReport;
  answer: string;
  citations: string[];
  /** Langfuse trace id, so the run page can deep-link into the dashboard. */
  traceId: string;
  totalMs: number;
  error?: string;
};

/** The conversation as the browser sends it. */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
